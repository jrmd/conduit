import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,copyFile,chmod,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {runInteractiveProvider} from "./interactive-provider";
import type {ApprovalMode,ProviderId} from "../shared/api";

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
