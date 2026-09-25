import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,copyFile,chmod,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {runInteractiveProvider, createClaudePermissionHandler} from "./interactive-provider";
import type {ApprovalMode,ProviderId} from "../shared/api";
import {discoverModels, clearModelCatalogues} from './providers';
import {runWithDelegation, callProviderTool} from './delegation';
import {planTool} from './planning';

test("interactive transports route denials and Auto fallbacks, stream thinking, and only auto-accept edits in the edit mode",{skip:process.platform==="win32"},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"conduit-rpc-test-"));const executable=join(dir,"provider");
 try {
  await copyFile("scripts/fixtures/approval-provider.mjs",executable);await chmod(executable,0o755);
  for(const provider of ["codex","cursor","opencode","copilot"] as ProviderId[]) for(const mode of ["supervised","auto-edits","auto","full-access"] as ApprovalMode[]) {
   const log=join(dir,`${provider}-${mode}.jsonl`);let asked=0;let text="";const thinking=new Map<string,{detail:string;status:string}>();
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);
   try {
    await runInteractiveProvider({provider,cwd:dir,mode,sessionId:"existing",prompt:"test",signal:controller.signal,onApproval:async()=>{assert.deepEqual([...thinking.values()],[{detail:"Checking ",status:"running"}]);asked++;return false;},onEvent:e=>{if(e.kind==="text")text+=e.text;const a=e.activity;if(a?.kind==="reasoning")thinking.set(a.id,{detail:(a.append?thinking.get(a.id)?.detail || "":"")+a.detail,status:a.status});}},executable,{...process.env,CONDUIT_PROTOCOL_LOG:log,CONDUIT_TOOL_KIND:"edit"});
    // Codex owns policy decisions; all requests it does send must still be surfaced.
    const autoAllowed=provider!=="codex" && (mode==="auto-edits"||mode==="full-access");
    assert.equal(asked,autoAllowed?0:1,`${provider} ${mode}`);assert.equal(text,autoAllowed?"Allowed":"Denied");
    const records=(await readFile(log,"utf8")).trim().split("\n").map(line=>JSON.parse(line));
    assert.ok(records.some(r=>r.method===(provider==="codex"?"thread/resume":"session/load")));
    // Thinking streams into one step and settles once the agent moves on.
    assert.deepEqual([...thinking.values()],[{detail:"Checking files",status:"completed"}],`${provider} ${mode} thinking`);
   } finally {clearTimeout(timer);}
  }
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('Codex dynamic tools dispatch through delegation, reject foreign sessions and survive resume', {skip:process.platform==='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'conduit-delegation-rpc-'));const executable=join(dir,'provider');
 try {
  await copyFile('scripts/fixtures/delegation-provider.mjs',executable);await chmod(executable,0o755);
  for(const sessionId of [undefined,'fixture-session']) {
   const log=join(dir,sessionId?'resume.jsonl':'start.jsonl');let text='';let children=0;
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);
   try {
    await runWithDelegation({provider:'codex',cwd:dir,prompt:'review',sessionId,signal:controller.signal,onEvent:e=>{if(e.kind==='text')text+=e.text;}},['claude'],async input=>{
     if(input.readOnlyChild) {children++;input.onEvent({kind:'text',text:'review evidence'});return {sessionId:'child-session'};}
     return runInteractiveProvider(input,executable,{...process.env,CONDUIT_PROTOCOL_LOG:log});
    });
    assert.equal(children,1);assert.match(text,/review evidence/);
    const records=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(records.find(r=>r.id==='foreign').result.success,false);
    const start=records.find(r=>r.method===(sessionId?'thread/resume':'thread/start'));
    if(!sessionId) {assert.equal(start.params.dynamicTools.length,3);assert.equal(start.params.dynamicTools[0].type,'function');}
    assert.equal(records.find(r=>r.id==='wait').result.success,true);
   } finally {clearTimeout(timer);}
  }
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('Codex children force read-only access and disable inherited MCP, apps and native delegation', {skip:process.platform==='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'conduit-readonly-rpc-'));const executable=join(dir,'provider');const log=join(dir,'requests.jsonl');
 try {
  await copyFile('scripts/fixtures/delegation-provider.mjs',executable);await chmod(executable,0o755);
  await runInteractiveProvider({provider:'codex',cwd:dir,prompt:'review',mode:'full-access',readOnlyChild:true,signal:new AbortController().signal,onEvent:()=>{}},executable,{...process.env,CONDUIT_PROTOCOL_LOG:log,CONDUIT_READONLY_TEST:'1'});
  const records=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const {params}=records.find(r=>r.method==='thread/start');
  assert.equal(params.sandbox,'read-only');assert.equal(params.approvalPolicy,'never');
  assert.equal(params.config['mcp_servers.unsafe.enabled'],false);
  assert.equal(params.config['features.multi_agent'],false);
  assert.equal(params.config['features.apps'],false);
  assert.equal(params.dynamicTools,undefined);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('native plan modes, checklist events and provider-specific question answers round trip', {skip:process.platform==='win32'}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),'conduit-planning-rpc-'));const executable=join(dir,'provider');
 try {
  await copyFile('scripts/fixtures/planning-provider.mjs',executable);await chmod(executable,0o755);
  for(const provider of ['codex','cursor'] as ProviderId[]) {
   const log=join(dir,provider+'.jsonl');const plans:any[]=[];let asked=0;
   const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),5000);
   try {
    await runInteractiveProvider({provider,cwd:dir,prompt:'Plan persistence',planning:true,mode:'full-access',signal:controller.signal,onPlan:plan=>plans.push(plan),onQuestion:async qs=>{asked++;assert.equal(qs[0].text,'Which storage?');return {storage:[qs[0].options[0].value]};},onEvent:()=>{}},executable,{...process.env,CONDUIT_PROTOCOL_LOG:log});
    assert.equal(asked,1);assert.equal(plans[0].steps[0].status,'completed');
    const records=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    const answer=records.find(r=>r.id==='question').result;
    if(provider==='codex') {
     assert.deepEqual(answer,{answers:{storage:{answers:['SQLite']}}});
     assert.equal(records.find(r=>r.method==='thread/start').params.sandbox,'read-only');
     assert.equal(records.find(r=>r.method==='turn/start').params.collaborationMode.mode,'plan');
     assert.match(plans[1].brief,/Decision: use SQLite/);
    } else {
     assert.deepEqual(answer,{outcome:{outcome:'answered',answers:[{questionId:'storage',selectedOptionIds:['sqlite']}]}});
     assert.equal(records.find(r=>r.method==='session/set_mode').params.modeId,'plan');
    }
   } finally {clearTimeout(timeout);}
  }
 } finally {await rm(dir,{recursive:true,force:true});}
});

 test('Cursor selected models use ACP variant IDs and retain actionable RPC errors', {skip:process.platform==='win32'}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),'conduit-cursor-model-'));const executable=join(dir,'provider');
 try {
  await copyFile('scripts/fixtures/approval-provider.mjs',executable);await chmod(executable,0o755);
  const run=(model:string)=>runInteractiveProvider({provider:'cursor',cwd:dir,prompt:'hello',model,signal:AbortSignal.timeout(5000),onEvent:()=>{}},executable,{...process.env,CONDUIT_CURSOR_MODELS:'1'});
  await run('gpt-5.6-luna[reasoning=medium,fast=false]');
  await assert.rejects(run('unavailable'), /session\/set_config_option.*Invalid model value: unavailable/);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('Cursor discovery returns the same IDs accepted by ACP execution', {skip:process.platform==='win32'}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),'conduit-cursor-discovery-'));const executable=join(dir,'cursor-agent');
 const previousPath=process.env.PATH, previousFixture=process.env.CONDUIT_CURSOR_MODELS;
 try {
  await copyFile('scripts/fixtures/approval-provider.mjs',executable);await chmod(executable,0o755);
  process.env.PATH=dir+':'+previousPath;process.env.CONDUIT_CURSOR_MODELS='1';clearModelCatalogues();
  const catalogue=await discoverModels('cursor');
  assert.equal(catalogue.options[0]?.id,'gpt-5.6-luna[reasoning=medium,fast=false]');
  await runInteractiveProvider({provider:'cursor',cwd:dir,prompt:'hello',model:catalogue.options[0].id,signal:AbortSignal.timeout(5000),onEvent:()=>{}},executable,{...process.env});
 } finally {
  if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;
  if(previousFixture===undefined)delete process.env.CONDUIT_CURSOR_MODELS;else process.env.CONDUIT_CURSOR_MODELS=previousFixture;
  clearModelCatalogues();await rm(dir,{recursive:true,force:true});
 }
});

 test('Claude planning permits the registered plan save tool while denying implementation tools', async () => {
  let saved: unknown;
  const tool = planTool(async plan => {saved = plan;});
  const permission = createClaudePermissionHandler({provider:'claude',cwd:'.',prompt:'Plan',planning:true,tools:[tool],signal:new AbortController().signal,onEvent:()=>{}},async()=>false);
  const args = {brief:'Goal: save plans. Validate restart.',steps:[{text:'Implement persistence',status:'pending'}]};
  assert.equal((await permission('mcp__conduit__conduit_update_plan',args)).behavior,'allow');
  assert.equal((await callProviderTool([tool],'conduit_update_plan',args)).success,true);
  assert.deepEqual(saved,args);
  assert.equal((await permission('Write',{file_path:'app.ts',content:'implementation'})).behavior,'deny');
  const exit = await permission('ExitPlanMode',{});
  assert.equal(exit.behavior,'deny');
  assert.doesNotMatch(exit.message || '',/Plan saved/);
  assert.match(exit.message || '',/mcp__conduit__conduit_update_plan/);
  assert.equal((await callProviderTool([tool],'conduit_update_plan',{...args,brief:' '})).success,false);
 });
