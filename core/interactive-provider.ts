import { planSteps } from './planning';
import type { RunProviderArgs } from "./providers";
import { approvalMode } from "../shared/approval";
import { prepareAttachments } from "./attachments";
import { ProviderRpc } from "./provider-rpc";
import { createActivityParser } from "./activity";
import { createClaudeTextStream } from "./response-stream";
import { z } from 'zod';
import { callProviderTool, type ProviderTool } from './delegation';
import { acpUsage, claudeUsage, codexUsage } from './usage';

export async function createClaudeToolServer(tools: readonly ProviderTool[]) {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');
  return createSdkMcpServer({ name: 'conduit', version: '1.0.0', tools: tools.map(definition =>
    tool(definition.name, definition.description, definition.schema, async args => {
      const result = await callProviderTool(tools, definition.name, args);
      return { content: [{ type: 'text' as const, text: result.text }], isError: !result.success };
    }, { alwaysLoad: true })) });
}

export function createClaudePermissionHandler(input: RunProviderArgs, ask: (name: string, params: unknown) => Promise<boolean>) {
  return async (name: string, params: Record<string, unknown>) => {
    if (input.signal.aborted) return {behavior:'deny' as const,message:'Run cancelled'};
    // Saving an app-owned plan is allowed in Plan mode; the generic
    // planning gate below intentionally denies implementation actions.
    if (!input.readOnlyChild && name === 'mcp__conduit__conduit_update_plan' && input.tools?.some(tool => tool.name === 'conduit_update_plan')) {
      return {behavior:'allow' as const,updatedInput:params};
    }
    if(name === 'AskUserQuestion' && input.onQuestion && !input.readOnlyChild) {
      const qs = (params.questions as any[] || []).map((q:any,i:number)=>({id:String(i),text:q.question,options:(q.options || []).map((o:any)=>({value:o.label,label:o.label,description:o.description})),multiple:q.multiSelect,freeText:true}));
      const answers = await input.onQuestion(qs);
      return answers ? {behavior:'allow' as const,updatedInput:{...params,answers:Object.fromEntries(qs.map(q=>[q.text,answers[q.id].join(', ')]))}} : {behavior:'deny' as const,message:'User skipped the questions'};
    }
    if(name === 'ExitPlanMode' && input.planning) {
      if(typeof params.plan === 'string' && params.plan.trim()) input.onPlan?.({brief:params.plan});
      return {behavior:'deny' as const,message:'Remain in planning mode. Save the complete brief and steps with mcp__conduit__conduit_update_plan, then end this turn with the complete plan inside <proposed_plan> tags. The user will start implementation in a fresh session.'};
    }
    return await ask(name,params) ? {behavior:'allow' as const,updatedInput:params} : {behavior:'deny' as const,message:'Action denied'};
  };
}

export function codexPermissions(mode: ReturnType<typeof approvalMode>) {
  return { sandbox: mode === "full-access" ? "danger-full-access" : mode === "supervised" ? "read-only" : "workspace-write",
    approvalPolicy: mode === "full-access" ? "never" : mode === "auto" ? "on-request" : "untrusted",
    approvalsReviewer: mode === "auto" ? "auto_review" : "user" };
}

export async function runInteractiveProvider(input: RunProviderArgs, executable: string, env: NodeJS.ProcessEnv): Promise<{sessionId?:string}> {
  const mode = approvalMode(input.mode || "supervised");
  const ask = (title:string, detail:unknown) => input.signal.aborted || input.readOnlyChild || input.planning ? Promise.resolve(false) : input.onApproval?.(title,typeof detail === "string" ? detail : JSON.stringify(detail,null,2)) || Promise.resolve(false);
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
    const mcpServers = input.tools?.length ? { conduit: await createClaudeToolServer(input.tools) } : undefined;
    const run = query({prompt:prompt(),options:{cwd:input.cwd,env,pathToClaudeCodeExecutable:executable,abortController:controller,
      resume:input.sessionId,model:input.model,
      settings:{fastMode:input.fastMode ?? false, ...(input.readOnlyChild ? {disableAllHooks:true} : {})},includePartialMessages:true,settingSources:input.readOnlyChild ? [] : ["user","project","local"],
      // Recent models omit thinking text unless a summarized display is requested.
      extraArgs:{"thinking-display":"summarized",...(input.effort ? {effort:input.effort} : {}), ...(input.readOnlyChild ? {'strict-mcp-config':null} : {})},
      ...(input.readOnlyChild ? {tools:['Read','Glob','Grep'], allowedTools:['Read','Glob','Grep'], disallowedTools:['Agent','Task','Bash','Write','Edit','NotebookEdit']} : {mcpServers, allowedTools:input.tools?.map(t=>`mcp__conduit__${t.name}`)}),
      permissionMode:input.planning ? "plan" : input.readOnlyChild ? 'default' : mode === "full-access" ? "bypassPermissions" : mode === "auto-edits" ? "acceptEdits" : mode === "auto" ? "auto" : "default",
      allowDangerouslySkipPermissions:!input.readOnlyChild && !input.planning && mode === "full-access",
      canUseTool:createClaudePermissionHandler(input, ask),
    }});
    try {
      for await(const message of run) {
        if("session_id" in message) {sessionId=message.session_id;input.onEvent({kind:"status",text:"Session active",sessionId});}
        if(message.type === 'assistant' && !message.parent_tool_use_id) for(const block of message.message.content) {
          if(block.type === 'tool_use' && block.name === 'TodoWrite') input.onPlan?.({steps:planSteps((block.input as any)?.todos)});
        }
        for(const item of activity(JSON.stringify(message))) input.onEvent({kind:"activity",text:item.title,activity:item});
        const delta=streamText(message); if(delta) input.onEvent({kind:"text",text:delta,sessionId});
        const usage=claudeUsage(message); if(usage) input.onEvent({kind:"usage",text:"",usage});
        if(message.type === "result" && message.is_error) throw new Error("errors" in message ? message.errors.join("\n") : "result" in message ? message.result : "Claude run failed");
      }
      return {sessionId};
    } finally {input.signal.removeEventListener("abort",abort);run.close();}
  }
  const codex = input.provider === "codex";
  const rpc = new ProviderRpc(executable,codex ? ["app-server"] : input.provider === "copilot" ? ["--acp","--stdio",...(input.effort ? ["--effort",input.effort] : [])] : input.provider === "cursor" && !input.planning && mode === "full-access" ? ["--force","--sandbox","disabled","acp"] : ["acp"],input.cwd,
    input.provider === "opencode" ? {...env,OPENCODE_PERMISSION:JSON.stringify({"*":"ask",read:"allow",glob:"allow",grep:"allow",list:"allow"})} : env,input.signal);
  let sessionId=input.sessionId;
  let resolveTurn:()=>void = ()=>{}; let rejectTurn:(error:Error)=>void = ()=>{};
  const finished=new Promise<void>((resolve,reject)=>{resolveTurn=resolve;rejectTurn=reject;});
  void finished.catch(()=>{});
  rpc.onFailure=rejectTurn;
  const items=new Map<string,any>();
  let prompting=false;
  // ACP streams thoughts as chunks without an item ID; each run of chunks becomes one Thinking step.
  let thought:string|undefined; let thoughts=0;
  const settleThought=()=>{ if(thought) input.onEvent({kind:"activity",text:"Thinking",activity:{id:thought,kind:"reasoning",title:"Thinking",detail:"",status:"completed",append:true}}); thought=undefined; };
  rpc.onNotification=(method,p)=>{
    if(!prompting) return; // Loading an existing session must not replay old messages.
    if(method === 'cursor/update_todos') input.onPlan?.({steps:planSteps(p.todos)});
    if(codex) {
      if(method === 'turn/plan/updated' && (!p.threadId || p.threadId === sessionId)) input.onPlan?.({steps:planSteps(p.plan)});
      if(method === 'item/completed' && p.item?.type === 'plan' && (!p.threadId || p.threadId === sessionId)) input.onPlan?.({brief:p.item.text});
      if(method==="item/agentMessage/delta") input.onEvent({kind:"text",text:p.delta || "",sessionId});
      if(method==="item/started" || method==="item/completed") {
        const item=p.item; if(!item) return; items.set(item.id,item);
        const status=method==="item/started"?"running":["failed","declined"].includes(item.status)?"failed":"completed";
        if(item.type==="reasoning") {
          // Summary deltas stream below; on start keep what has streamed, on completion settle the full text.
          const detail=method==="item/completed" ? [...(item.summary || []),...(item.content || [])].join("\n\n") : "";
          input.onEvent({kind:"activity",text:"Thinking",activity:{id:item.id,kind:"reasoning",title:"Thinking",detail,status,append:method==="item/started" || !detail}});
        } else if(item.type!=="agentMessage") input.onEvent({kind:"activity",text:item.type,activity:{id:item.id,kind:"tool",title:item.command || item.type,detail:JSON.stringify(item,null,2),status}});
      }
      if(method==="item/reasoning/summaryTextDelta" || method==="item/reasoning/textDelta" || method==="item/reasoning/summaryPartAdded") {
        const delta=method==="item/reasoning/summaryPartAdded" ? (p.summaryIndex > 0 ? "\n\n" : "") : p.delta || "";
        if(delta) input.onEvent({kind:"activity",text:"Thinking",activity:{id:p.itemId,kind:"reasoning",title:"Thinking",detail:delta,status:"running",append:true}});
      }
      if(method==="thread/tokenUsage/updated" && p.threadId === sessionId) { const usage=codexUsage(p); if(usage) input.onEvent({kind:"usage",text:"",usage}); }
      if(method==="turn/completed") { if(p.turn?.status==="failed" || p.turn?.status==="interrupted") rejectTurn(new Error(p.turn.error?.message || `Codex turn ${p.turn.status}`)); else resolveTurn(); }
    } else if(method==="session/update") {
      const u=p.update;
      if(u?.sessionUpdate === 'plan') input.onPlan?.({steps:planSteps(u.entries)});
      const usage=acpUsage(u); if(usage) input.onEvent({kind:"usage",text:"",usage});
      if(u?.sessionUpdate==="agent_message_chunk" && u.content?.type==="text") { settleThought(); input.onEvent({kind:"text",text:u.content.text,sessionId}); }
      if(u?.sessionUpdate==="agent_thought_chunk" && u.content?.type==="text") {
        thought ??= `thought-${thoughts++}`;
        input.onEvent({kind:"activity",text:"Thinking",activity:{id:thought,kind:"reasoning",title:"Thinking",detail:u.content.text,status:"running",append:true}});
      }
      if(u?.sessionUpdate==="tool_call" || u?.sessionUpdate==="tool_call_update") {
        settleThought();
        const item={...items.get(u.toolCallId),...u};items.set(u.toolCallId,item);
        input.onEvent({kind:"activity",text:item.title || "Tool",activity:{id:u.toolCallId,kind:"tool",title:item.title || "Tool",detail:JSON.stringify(item.rawInput || item.content || {},null,2),status:item.status==="completed"?"completed":item.status==="failed"?"failed":"running"}});
      }
    }
  };
  rpc.onRequest=async (method,p)=>{
    if(codex && method === 'item/tool/requestUserInput') {
      if(p.threadId !== sessionId) throw new Error('Question belongs to another session');
      const answers = await input.onQuestion?.((p.questions || []).map((q:any)=>({id:q.id,text:q.question,options:(q.options || []).map((o:any)=>({value:o.label,...o})),freeText:true,secret:q.isSecret}))) ?? null;
      return {answers:Object.fromEntries(Object.entries(answers || {}).map(([id,answers])=>[id,{answers}]))};
    }
    if(codex && method==="item/tool/call") {
      const result = p.threadId !== sessionId || input.signal.aborted
        ? {success:false,text:'Tool call does not belong to an active parent session'}
        : await callProviderTool(input.tools || [],p.tool,p.arguments);
      return {success:result.success,contentItems:[{type:'inputText',text:result.text}]};
    }
    if(codex && ["item/commandExecution/requestApproval","item/fileChange/requestApproval"].includes(method)) {
      const item=items.get(p.itemId);
      const detail=method.includes("fileChange") ? (item?.changes || []).map((change:any)=>`${change.path}\n${change.diff || JSON.stringify(change.kind)}`).join("\n\n") || p.reason || "File changes requested" : [p.command,p.cwd && `Working directory: ${p.cwd}`,p.reason,p.networkApprovalContext && JSON.stringify(p.networkApprovalContext),p.additionalPermissions && JSON.stringify(p.additionalPermissions)].filter(Boolean).join("\n\n");
      return {decision:await ask(method.includes("fileChange")?"Approve file changes":"Approve command",detail)?"accept":"decline"};
    }
    if(codex && method==="item/permissions/requestApproval") return {permissions:await ask("Approve additional access",p)?p.permissions:{},scope:"turn"};
    if(codex && method==="mcpServer/elicitation/request") return {action:"decline",content:null};
    if(!codex && method==="session/request_permission") {
      const tool={...items.get(p.toolCall?.toolCallId),...p.toolCall};
      const allow = !input.planning && (mode==="full-access" || (mode==="auto-edits" && tool.kind==="edit") || await ask(tool.title || "Approve action",tool));
      if(input.signal.aborted) return {outcome:{outcome:"cancelled"}};
      const option=p.options?.find((option:any)=>option.kind===(allow?"allow_once":"reject_once"));
      return {outcome:option?{outcome:"selected",optionId:option.optionId}:{outcome:"cancelled"}};
    }
    if(method==='cursor/create_plan') {
      input.onPlan?.({brief:p.plan,steps:planSteps(p.todos)});
      return {outcome:{outcome:'rejected',reason:'Saved for review and fresh-session handoff. End this turn with the plan; do not implement yet.'}};
    }
    if(method==='cursor/ask_question') {
      const answers = await input.onQuestion?.((p.questions || []).map((q:any)=>({id:q.id,text:q.prompt,options:(q.options || []).map((o:any)=>({value:o.id,label:o.label})),multiple:q.allowMultiple,freeText:false}))) ?? null;
      return {outcome:answers ? {outcome:'answered',answers:Object.entries(answers).map(([questionId,selectedOptionIds])=>({questionId,selectedOptionIds}))} : {outcome:'skipped'}};
    }
    throw new Error(`Unsupported provider request: ${method}`);
  };
  try {
    if(codex) {
      await rpc.request("initialize",{clientInfo:{name:"conduit",version:"0.5.0"},capabilities:{experimentalApi:true}});rpc.notify("initialized");
      const permissions=input.readOnlyChild || input.planning ? {sandbox:'read-only',approvalPolicy:'never',approvalsReviewer:'user'} : codexPermissions(mode);
      const config: Record<string, unknown> = input.contextWindow === undefined ? {} : {model_context_window:input.contextWindow};
      if(input.readOnlyChild) {
        // MCP tools and native delegation are outside the filesystem sandbox.
        const effective = await rpc.request('config/read',{cwd:input.cwd,includeLayers:false});
        for(const name of Object.keys(effective.config?.mcp_servers || {})) config[`mcp_servers.${name}.enabled`] = false;
        for(const feature of ['multi_agent','multi_agent_v2','apps','browser_use','browser_use_external','in_app_browser','computer_use']) config[`features.${feature}`] = false;
      }
      const dynamicTools=input.readOnlyChild ? undefined : input.tools?.map(t=>({type:'function',name:t.name,description:t.description,inputSchema:z.toJSONSchema(z.object(t.schema).strict()),deferLoading:false}));
      const result=await rpc.request(sessionId?"thread/resume":"thread/start",{...(sessionId?{threadId:sessionId}:{dynamicTools}),cwd:input.cwd,model:input.model,...permissions, config});
      sessionId=result.thread.id;input.onEvent({kind:"status",text:"Session started",sessionId});prompting=true;
      await rpc.request("turn/start",{summary:"auto",threadId:sessionId,input:[{type:"text",text,text_elements:[]},...images.map(file=>({type:"localImage",path:file.path}))],...(input.model || result.model ? {collaborationMode:{mode:input.planning ? 'plan' : 'default',settings:{model:input.model || result.model,reasoning_effort:input.effort || null,developer_instructions:null}}} : {}),effort:input.effort || null, serviceTierForTurn:input.fastMode ? "priority" : "default"});
      await finished;
    } else {
      const initialized=await rpc.request("initialize",{protocolVersion:1,clientCapabilities:{},clientInfo:{name:"conduit",version:"0.5.0"}});
      if(sessionId && !initialized.agentCapabilities?.loadSession) throw new Error("This provider cannot resume sessions through ACP. Start a new thread.");
      const result=await rpc.request(sessionId?"session/load":"session/new",{...(sessionId?{sessionId}:{}),cwd:input.cwd,mcpServers:[]});
      sessionId=result.sessionId || sessionId; if(!sessionId) throw new Error("Provider did not return a session ID");
      input.onEvent({kind:"status",text:"Session started",sessionId});
      if(input.planning) {
        const planMode=result.modes?.availableModes?.find((m:any)=>m.id==='plan');
        if(!planMode) throw new Error('This provider does not advertise a native Plan mode through ACP. Choose Codex, Claude, or another provider with Plan mode.');
        await rpc.request('session/set_mode',{sessionId,modeId:planMode.id});
      }
      if(!input.planning && result.modes?.currentModeId === 'plan') {
        const executionMode=result.modes.availableModes?.find((m:any)=>['agent','build','default'].includes(m.id));
        if(!executionMode) throw new Error('Cannot leave provider Plan mode; start a fresh session.');
        await rpc.request('session/set_mode',{sessionId,modeId:executionMode.id});
      }
      let configOptions=result.configOptions;
      // A resumed Copilot session may have persisted allow-all from another client.
      // Keep permission decisions in Conduit, including its Full access policy.
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
      settleThought();
    }
    return {sessionId};
  } finally {rpc.close();}
}
