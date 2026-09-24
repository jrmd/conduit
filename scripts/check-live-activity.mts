import { runProvider } from '../core/providers';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const cwd=await mkdtemp(join(tmpdir(),'j2code-live-activity-'));
const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),60000);
const kinds=new Set<string>();let answer='',error='',sessionId='';let agentEvents=0,toolEvents=0;
try {
 const result=await runProvider({provider:'codex',cwd,mode:'read',prompt:'Verification task: delegate to exactly one subagent to calculate 19 times 23 independently. Ask it not to run tools or read files. Also run a harmless printf command to print CHECK in your own shell. Report the arithmetic result. Do not read or modify any files, and do not create more than one subagent.',signal:controller.signal,onEvent:event=>{if(event.kind==='activity'&&event.activity){kinds.add(event.activity.kind);if(event.activity.kind==='agent')agentEvents++;if(event.activity.kind==='tool')toolEvents++;}if(event.kind==='text')answer+=event.text;}});
 sessionId=result.sessionId||'';
} catch(e){error=e instanceof Error?e.message:String(e)}finally{clearTimeout(timeout);await rm(cwd,{recursive:true,force:true})}
const report={provider:'codex',model:'CLI default',authenticatedLiveAttempt:true,sessionStarted:!!sessionId,activityKinds:[...kinds],agentEvents,toolEvents,correctAnswer:answer.includes('437'),error};
await writeFile(new URL('../artifacts/live-activity-014.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
