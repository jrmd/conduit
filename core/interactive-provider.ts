import type { RunProviderArgs } from "./providers";
import { approvalMode } from "../shared/approval";
import { prepareAttachments } from "./attachments";
import { ProviderRpc } from "./provider-rpc";
import { createActivityParser } from "./activity";
import { createClaudeTextStream } from "./response-stream";

export function codexPermissions(mode: ReturnType<typeof approvalMode>) {
  return { sandbox: mode === "full-access" ? "danger-full-access" : mode === "supervised" ? "read-only" : "workspace-write",
    approvalPolicy: mode === "full-access" ? "never" : mode === "auto" ? "on-request" : "untrusted",
    approvalsReviewer: mode === "auto" ? "auto_review" : "user" };
}

export async function runInteractiveProvider(input: RunProviderArgs, executable: string, env: NodeJS.ProcessEnv): Promise<{sessionId?:string}> {
  const mode = approvalMode(input.mode || "supervised");
  const ask = (title:string, detail:unknown) => input.signal.aborted ? Promise.resolve(false) : input.onApproval?.(title,typeof detail === "string" ? detail : JSON.stringify(detail,null,2)) || Promise.resolve(false);
  const {text,images} = prepareAttachments(input.provider,input.prompt,input.attachments || []);
  if(input.provider === "claude") {
    const {query} = await import("@anthropic-ai/claude-agent-sdk");
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal.addEventListener("abort",abort,{once:true});
    if(input.signal.aborted) abort();
    const content: any[] = [...images.map(file=>({type:"image",source:{type:"base64",media_type:file.mime,data:file.data.toString("base64")}})),{type:"text",text}];
    const prompt = async function*() { yield {type:"user" as const,session_id:input.sessionId || "",parent_tool_use_id:null,message:{role:"user" as const,content}}; };
    const streamText = createClaudeTextStream(); const activity = createActivityParser("claude");
    let sessionId = input.sessionId;
    const run = query({prompt:prompt(),options:{cwd:input.cwd,env,pathToClaudeCodeExecutable:executable,abortController:controller,
      resume:input.sessionId,model:input.model,
      settings:{fastMode:input.fastMode ?? false},includePartialMessages:true,settingSources:["user","project","local"],
      ...(input.effort ? {extraArgs:{effort:input.effort}} : {}),
      permissionMode:mode === "full-access" ? "bypassPermissions" : mode === "auto-edits" ? "acceptEdits" : mode === "auto" ? "auto" : "default",
      allowDangerouslySkipPermissions:mode === "full-access",
      canUseTool:async (name,params) => await ask(name,params) ? {behavior:"allow",updatedInput:params} : {behavior:"deny",message:"Denied by the user"},
    }});
    try {
      for await(const message of run) {
        if("session_id" in message) {sessionId=message.session_id;input.onEvent({kind:"status",text:"Session active",sessionId});}
        for(const item of activity(JSON.stringify(message))) input.onEvent({kind:"activity",text:item.title,activity:item});
        const delta=streamText(message); if(delta) input.onEvent({kind:"text",text:delta,sessionId});
        if(message.type === "result" && message.is_error) throw new Error("errors" in message ? message.errors.join("\n") : "Claude run failed");
      }
      return {sessionId};
    } finally {input.signal.removeEventListener("abort",abort);run.close();}
  }
  const codex = input.provider === "codex";
  const rpc = new ProviderRpc(executable,codex ? ["app-server"] : input.provider === "copilot" ? ["--acp","--stdio",...(input.effort ? ["--effort",input.effort] : [])] : input.provider === "cursor" && mode === "full-access" ? ["--force","--sandbox","disabled","acp"] : ["acp"],input.cwd,
    input.provider === "opencode" ? {...env,OPENCODE_PERMISSION:JSON.stringify({"*":"ask",read:"allow",glob:"allow",grep:"allow",list:"allow"})} : env,input.signal);
  let sessionId=input.sessionId;
  let resolveTurn:()=>void = ()=>{}; let rejectTurn:(error:Error)=>void = ()=>{};
  const finished=new Promise<void>((resolve,reject)=>{resolveTurn=resolve;rejectTurn=reject;});
  void finished.catch(()=>{});
  rpc.onFailure=rejectTurn;
  const items=new Map<string,any>();
  let prompting=false;
  rpc.onNotification=(method,p)=>{
    if(!prompting) return; // Loading an existing session must not replay old messages.
    if(codex) {
      if(method==="item/agentMessage/delta") input.onEvent({kind:"text",text:p.delta || "",sessionId});
      if(method==="item/started" || method==="item/completed") {
        const item=p.item; if(!item) return; items.set(item.id,item);
        if(item.type!=="agentMessage") input.onEvent({kind:"activity",text:item.type,activity:{id:item.id,kind:item.type==="reasoning"?"reasoning":"tool",title:item.command || item.type,detail:JSON.stringify(item,null,2),status:method==="item/started"?"running":["failed","declined"].includes(item.status)?"failed":"completed"}});
      }
      if(method==="turn/completed") { if(p.turn?.status==="failed") rejectTurn(new Error(p.turn.error?.message || "Codex turn failed")); else resolveTurn(); }
    } else if(method==="session/update") {
      const u=p.update;
      if(u?.sessionUpdate==="agent_message_chunk" && u.content?.type==="text") input.onEvent({kind:"text",text:u.content.text,sessionId});
      if(u?.sessionUpdate==="tool_call" || u?.sessionUpdate==="tool_call_update") {
        const item={...items.get(u.toolCallId),...u};items.set(u.toolCallId,item);
        input.onEvent({kind:"activity",text:item.title || "Tool",activity:{id:u.toolCallId,kind:"tool",title:item.title || "Tool",detail:JSON.stringify(item.rawInput || item.content || {},null,2),status:item.status==="completed"?"completed":item.status==="failed"?"failed":"running"}});
      }
    }
  };
  rpc.onRequest=async (method,p)=>{
    if(codex && ["item/commandExecution/requestApproval","item/fileChange/requestApproval"].includes(method)) {
      const item=items.get(p.itemId);
      const detail=method.includes("fileChange") ? (item?.changes || []).map((change:any)=>`${change.path}\n${change.diff || JSON.stringify(change.kind)}`).join("\n\n") || p.reason || "File changes requested" : [p.command,p.cwd && `Working directory: ${p.cwd}`,p.reason,p.networkApprovalContext && JSON.stringify(p.networkApprovalContext),p.additionalPermissions && JSON.stringify(p.additionalPermissions)].filter(Boolean).join("\n\n");
      return {decision:await ask(method.includes("fileChange")?"Approve file changes":"Approve command",detail)?"accept":"decline"};
    }
    if(codex && method==="item/permissions/requestApproval") return {permissions:await ask("Approve additional access",p)?p.permissions:{},scope:"turn"};
    if(codex && method==="mcpServer/elicitation/request") return {action:"decline",content:null};
    if(!codex && method==="session/request_permission") {
      const tool={...items.get(p.toolCall?.toolCallId),...p.toolCall};
      const allow = mode==="full-access" || (mode==="auto-edits" && tool.kind==="edit") || await ask(tool.title || "Approve action",tool);
      if(input.signal.aborted) return {outcome:{outcome:"cancelled"}};
      const option=p.options?.find((option:any)=>option.kind===(allow?"allow_once":"reject_once"));
      return {outcome:option?{outcome:"selected",optionId:option.optionId}:{outcome:"cancelled"}};
    }
    if(method==="cursor/create_plan") return {outcome:{outcome:await ask(p.name || "Approve plan",p.plan)?"accepted":"rejected"}};
    if(method==="cursor/ask_question") return {outcome:{outcome:"skipped",reason:"Question input is not supported by this client"}};
    throw new Error(`Unsupported provider request: ${method}`);
  };
  try {
    if(codex) {
      await rpc.request("initialize",{clientInfo:{name:"vulp",version:"0.5.0"},capabilities:{experimentalApi:true}});rpc.notify("initialized");
      const permissions=codexPermissions(mode);
      const result=await rpc.request(sessionId?"thread/resume":"thread/start",{...(sessionId?{threadId:sessionId}:{}),cwd:input.cwd,model:input.model,...permissions, config:input.contextWindow === undefined ? {} : {model_context_window:input.contextWindow}});
      sessionId=result.thread.id;input.onEvent({kind:"status",text:"Session started",sessionId});prompting=true;
      await rpc.request("turn/start",{threadId:sessionId,input:[{type:"text",text,text_elements:[]},...images.map(file=>({type:"localImage",path:file.path}))],effort:input.effort || null, serviceTierForTurn:input.fastMode ? "priority" : "default"});
      await finished;
    } else {
      const initialized=await rpc.request("initialize",{protocolVersion:1,clientCapabilities:{},clientInfo:{name:"vulp",version:"0.5.0"}});
      if(sessionId && !initialized.agentCapabilities?.loadSession) throw new Error("This provider cannot resume sessions through ACP. Start a new thread.");
      const result=await rpc.request(sessionId?"session/load":"session/new",{...(sessionId?{sessionId}:{}),cwd:input.cwd,mcpServers:[]});
      sessionId=result.sessionId || sessionId; if(!sessionId) throw new Error("Provider did not return a session ID");
      input.onEvent({kind:"status",text:"Session started",sessionId});
      let configOptions=result.configOptions;
      // A resumed Copilot session may have persisted allow-all from another client.
      // Keep permission decisions in Vulp, including its Full access policy.
      if(input.provider === "copilot" && configOptions?.some((option:any)=>option.id==="allow_all")) {
        await rpc.request("session/set_config_option",{sessionId,configId:"allow_all",value:"off"});
      }
      if(input.model) {
        const modelOption=configOptions?.find((option:any)=>option.category==="model" || option.id==="model");
        if(modelOption) {
          const updated=await rpc.request("session/set_config_option",{sessionId,configId:modelOption.id,value:input.model});
          configOptions=updated.configOptions;
        } else await rpc.request("session/set_model",{sessionId,modelId:input.model});
      }
      if(input.effort && input.provider !== "copilot") {
        const option=configOptions?.find((option:any)=>option.category==="thought_level" || option.id==="effort");
        if(!option) throw new Error("This provider ACP interface does not expose reasoning effort. Select Auto effort.");
        await rpc.request("session/set_config_option",{sessionId,configId:option.id,value:input.effort});
      }
      prompting=true;
      await rpc.request("session/prompt",{sessionId,prompt:[{type:"text",text},...images.map(file=>({type:"image",mimeType:file.mime,data:file.data.toString("base64")}))]});
    }
    return {sessionId};
  } finally {rpc.close();}
}
