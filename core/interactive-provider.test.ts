import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,copyFile,chmod,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {runInteractiveProvider} from "./interactive-provider";
import type {ApprovalMode,ProviderId} from "../shared/api";
import {runWithDelegation} from './delegation';

test("interactive transports route denials and Auto fallbacks, stream thinking, and only auto-accept edits in the edit mode",{skip:process.platform==="win32"},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"vulp-rpc-test-"));const executable=join(dir,"provider");
 try {
  await copyFile("scripts/fixtures/approval-provider.mjs",executable);await chmod(executable,0o755);
  for(const provider of ["codex","cursor","opencode","copilot"] as ProviderId[]) for(const mode of ["supervised","auto-edits","auto","full-access"] as ApprovalMode[]) {
   const log=join(dir,`${provider}-${mode}.jsonl`);let asked=0;let text="";const thinking=new Map<string,{detail:string;status:string}>();
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);
   try {
    await runInteractiveProvider({provider,cwd:dir,mode,sessionId:"existing",prompt:"test",signal:controller.signal,onApproval:async()=>{assert.deepEqual([...thinking.values()],[{detail:"Checking ",status:"running"}]);asked++;return false;},onEvent:e=>{if(e.kind==="text")text+=e.text;const a=e.activity;if(a?.kind==="reasoning")thinking.set(a.id,{detail:(a.append?thinking.get(a.id)?.detail || "":"")+a.detail,status:a.status});}},executable,{...process.env,VULP_PROTOCOL_LOG:log,VULP_TOOL_KIND:"edit"});
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
 const dir=await mkdtemp(join(tmpdir(),'vulp-delegation-rpc-'));const executable=join(dir,'provider');
 try {
  await copyFile('scripts/fixtures/delegation-provider.mjs',executable);await chmod(executable,0o755);
  for(const sessionId of [undefined,'fixture-session']) {
   const log=join(dir,sessionId?'resume.jsonl':'start.jsonl');let text='';let children=0;
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);
   try {
    await runWithDelegation({provider:'codex',cwd:dir,prompt:'review',sessionId,signal:controller.signal,onEvent:e=>{if(e.kind==='text')text+=e.text;}},['claude'],async input=>{
     if(input.readOnlyChild) {children++;input.onEvent({kind:'text',text:'review evidence'});return {sessionId:'child-session'};}
     return runInteractiveProvider(input,executable,{...process.env,VULP_PROTOCOL_LOG:log});
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
 const dir=await mkdtemp(join(tmpdir(),'vulp-readonly-rpc-'));const executable=join(dir,'provider');const log=join(dir,'requests.jsonl');
 try {
  await copyFile('scripts/fixtures/delegation-provider.mjs',executable);await chmod(executable,0o755);
  await runInteractiveProvider({provider:'codex',cwd:dir,prompt:'review',mode:'full-access',readOnlyChild:true,signal:new AbortController().signal,onEvent:()=>{}},executable,{...process.env,VULP_PROTOCOL_LOG:log,VULP_READONLY_TEST:'1'});
  const records=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const {params}=records.find(r=>r.method==='thread/start');
  assert.equal(params.sandbox,'read-only');assert.equal(params.approvalPolicy,'never');
  assert.equal(params.config['mcp_servers.unsafe.enabled'],false);
  assert.equal(params.config['features.multi_agent'],false);
  assert.equal(params.config['features.apps'],false);
  assert.equal(params.dynamicTools,undefined);
 } finally {await rm(dir,{recursive:true,force:true});}
});
