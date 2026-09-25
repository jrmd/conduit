#!/usr/bin/env node
// App Server protocol fixture. No model/network calls.
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
const request=(id,tool,args,threadId='fixture-session')=>send({id,method:'item/tool/call',params:{threadId,turnId:'turn',callId:id,namespace:null,tool,arguments:args}});
createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);
  if(process.env.VULP_PROTOCOL_LOG) appendFileSync(process.env.VULP_PROTOCOL_LOG,line+'\n');
  if(m.id==='foreign') return request('spawn','vulp_spawn_agent',{provider:'claude',task:'review'});
  if(m.id==='spawn') {
    const result=JSON.parse(m.result.contentItems[0].text);
    return request('wait','vulp_wait_agent',{agentId:result.agentId,timeoutMs:100});
  }
  if(m.id==='wait') {
    send({method:'item/agentMessage/delta',params:{delta:m.result.contentItems[0].text}});
    return send({method:'turn/completed',params:{turn:{status:'completed'}}});
  }
  if(m.id===undefined || !m.method) return;
  if(m.method==='initialize') return send({id:m.id,result:{}});
  if(m.method==='config/read') return send({id:m.id,result:{config:{mcp_servers:{unsafe:{command:'unsafe'}}}}});
  if(m.method==='thread/start' || m.method==='thread/resume') return send({id:m.id,result:{thread:{id:'fixture-session'}}});
  if(m.method==='turn/start') {
    send({id:m.id,result:{turn:{id:'turn'}}});
    if(process.env.VULP_READONLY_TEST) {
      send({method:'item/agentMessage/delta',params:{delta:'Read-only findings'}});
      return send({method:'turn/completed',params:{turn:{status:'completed'}}});
    }
    return request('foreign','vulp_spawn_agent',{provider:'claude',task:'foreign'},'wrong-session');
  }
  send({id:m.id,result:{}});
});
