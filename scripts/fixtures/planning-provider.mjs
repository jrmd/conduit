#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
if(process.argv.includes('--version')) { console.log('fixture 1.0'); process.exit(0); }
const codex = process.argv.includes('app-server');
const send = value => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
let promptId;
createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);
  if(process.env.VULP_PROTOCOL_LOG) appendFileSync(process.env.VULP_PROTOCOL_LOG,JSON.stringify(m)+'\n');
  if(m.id==='question') {
    if(codex) {
      send({method:'turn/plan/updated',params:{plan:[{step:'Choose storage',status:'completed'},{step:'Implement persistence',status:'pending'}]}});
      send({method:'item/completed',params:{item:{id:'plan',type:'plan',text:'Goal: save plans. Decision: use SQLite. Files: store.ts. Validate restart persistence.\n1. Choose storage\n2. Implement persistence'}}});
      send({method:'item/agentMessage/delta',params:{delta:'Plan ready for handoff.'}});
      send({method:'turn/completed',params:{turn:{status:'completed'}}});
    } else {
      send({method:'session/update',params:{update:{sessionUpdate:'plan',entries:[{content:'Choose storage',status:'completed'},{content:'Implement persistence',status:'pending'}]}}});
      send({method:'session/update',params:{update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'1. Choose storage\n2. Implement persistence'}}}});
      send({id:promptId,result:{stopReason:'end_turn'}});
    }
    return;
  }
  if(!m.method || m.id===undefined) return;
  if(m.method==='initialize') return send({id:m.id,result:{agentCapabilities:{loadSession:true}}});
  if(m.method==='thread/start' || m.method==='thread/resume') return send({id:m.id,result:{thread:{id:'fresh-session'},model:'gpt-6-sol'}});
  if(m.method==='session/new' || m.method==='session/load') return send({id:m.id,result:{sessionId:'fresh-session',modes:{currentModeId:'agent',availableModes:[{id:'plan',name:'Plan'},{id:'agent',name:'Agent'}]}}});
  if(m.method==='turn/start' || m.method==='session/prompt') {
    promptId=m.id;
    if(codex) send({id:m.id,result:{turn:{id:'turn'}}});
    send({id:'question',method:codex?'item/tool/requestUserInput':'cursor/ask_question',params:codex?{threadId:'fresh-session',questions:[{id:'storage',question:'Which storage?',options:[{label:'SQLite',description:'Local database'},{label:'JSON',description:'Simple file'}]}]}:{questions:[{id:'storage',prompt:'Which storage?',options:[{id:'sqlite',label:'SQLite'},{id:'json',label:'JSON'}]}]}});
    return;
  }
  send({id:m.id,result:{}});
});
