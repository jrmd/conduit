import {runProvider} from '../core/providers';
import {planTool,planningInstructions} from '../core/planning';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ProviderId,Plan} from '../shared/api';
const reports=[];
for(const provider of (process.argv[2] ? [process.argv[2]] : ['codex','claude']) as ProviderId[]) {
 const cwd=await mkdtemp(join(tmpdir(),'conduit-live-plan-')),controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),90000);
 let questions=0,answer='',sessionId='',error='',plan:Partial<Plan>={};
 try {
  const result=await runProvider({provider,cwd,mode:'supervised',planning:true,prompt:planningInstructions+'\nVerification: plan a tiny local todo app, without tools that access files, shell, network or subagents. First use your native user-question tool to ask whether storage should be SQLite or JSON. Wait for the answer. Then produce a short plan reflecting it, with two todo steps. Do not implement anything.',tools:[planTool(async update=>{plan={...plan,...update};})],signal:controller.signal,onQuestion:async qs=>{questions++;return Object.fromEntries(qs.map(q=>[q.id,[q.options.find(o=>/sqlite/i.test(o.label))?.value || 'SQLite']]));},onPlan:update=>{plan={...plan,...update};},onEvent:event=>{if(event.kind==='text')answer+=event.text;}});sessionId=result.sessionId||'';
 } catch(e) {error=String(e);} finally {clearTimeout(timeout);await rm(cwd,{recursive:true,force:true});}
 const report={provider,sessionStarted:!!sessionId,questions,planSteps:plan.steps?.length||0,briefReceived:!!plan.brief,answerReflectsChoice:/sqlite/i.test(answer+' '+plan.brief),error};reports.push(report);console.log(JSON.stringify(report));
}
await writeFile(`artifacts/live-planning${process.argv[2] ? '-'+process.argv[2] : ''}.json`,JSON.stringify(reports,null,2));
if(reports.some(r=>r.error || !r.questions || !r.answerReflectsChoice)) process.exitCode=1;
