#!/usr/bin/env node
// Deterministic provider protocol fixture. No model, network, or tool execution.
import {createInterface} from "node:readline";
import {appendFileSync} from "node:fs";
if(process.argv.includes("--version")){console.log("fixture 1.0");process.exit(0);}
const codex=process.argv.includes("app-server");
const send=value=>process.stdout.write(JSON.stringify({jsonrpc:"2.0",...value})+"\n");
let promptId;
createInterface({input:process.stdin}).on("line",line=>{
 const m=JSON.parse(line);const p=m.params || {};
 if(process.env.VULP_PROTOCOL_LOG) appendFileSync(process.env.VULP_PROTOCOL_LOG,JSON.stringify(m)+"\n");
 if(m.id==="approval") {
   const allowed=codex ? m.result?.decision==="accept" : m.result?.outcome?.optionId==="yes";
   if(codex){send({method:"item/agentMessage/delta",params:{delta:allowed?"Allowed":"Denied"}});send({method:"turn/completed",params:{turn:{status:"completed"}}});}
   else {send({method:"session/update",params:{update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:allowed?"Allowed":"Denied"}}}});send({id:promptId,result:{stopReason:"end_turn"}});}
   return;
 }
 if(!m.method || m.id===undefined) return;
 if(m.method==="initialize") return send({id:m.id,result:{agentCapabilities:{loadSession:true}}});
 if(m.method==="thread/start" || m.method==="thread/resume") return send({id:m.id,result:{thread:{id:"fixture-session"}}});
 if(m.method==="session/new" || m.method==="session/load") return send({id:m.id,result:{sessionId:"fixture-session"}});
 if(m.method==="turn/start" || m.method==="session/prompt") {
   promptId=m.id;
   if(codex) send({id:m.id,result:{turn:{id:"fixture-turn"}}});
   send({id:"approval",method:codex?"item/commandExecution/requestApproval":"session/request_permission",params:codex?{threadId:"fixture-session",turnId:"fixture-turn",itemId:"tool",command:"echo fixture",cwd:process.cwd()}:{sessionId:"fixture-session",toolCall:{toolCallId:"tool",title:"Fixture action",kind:process.env.VULP_TOOL_KIND || "execute",rawInput:{command:"echo fixture"}},options:[{optionId:"yes",kind:"allow_once",name:"Allow once"},{optionId:"no",kind:"reject_once",name:"Deny"}]}});
   return;
 }
 send({id:m.id,result:{}});
});
