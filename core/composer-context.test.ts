import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, symlink, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { projectFiles, resolveReferences, capabilities } from "./composer-context";
import { normalizeTitle } from "./thread-title";
test("file references respect ignores, quote spaces and reject symlink escapes", async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),"vulp-context-"));
 try {
  execFileSync("git",["init","-q"],{cwd:root});
  await writeFile(path.join(root,".gitignore"),"secret.txt\n");
  await writeFile(path.join(root,"secret.txt"),"hidden");
  await writeFile(path.join(root,"hello world.ts"),"export {};");
  await symlink(os.tmpdir(),path.join(root,"outside"));
  const items=await projectFiles(root);
  assert(!items.some(item=>item.name==="secret.txt" || item.name==="outside"));
  const item=items.find(item=>item.name==="hello world.ts")!;
  assert.equal(item.token,'@"hello world.ts"');
  assert.match(await resolveReferences(root,"codex",[item.id],item.token),/Referenced project file: "hello world.ts"/);
  await assert.rejects(resolveReferences(root,"codex",["file:../secret"],"@../secret"));
 } finally {await rm(root,{recursive:true,force:true});}
});
test("local skills expose invocation and hide non-user-invocable skills",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"vulp-skills-"));
 try {
  for(const name of ["review-fixture","hidden-fixture"]){const dir=path.join(root,".cursor/skills",name);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,"SKILL.md"),`---\nname: ${name}\ndescription: Review project code\n${name.startsWith("hidden")?"user-invocable: false\n":""}---\nInstructions`);}
  const result=await capabilities(root,"cursor");
  assert.equal(result.items.find(item=>item.name==="review-fixture")?.token,"/review-fixture");
  assert(!result.items.some(item=>item.name==="hidden-fixture"));
 }finally{await rm(root,{recursive:true,force:true});}
});
test("generated title is short and unadorned",()=>{
 assert.equal(normalizeTitle('  "Fix parser delimiters"\nExplanation'),"Fix parser delimiters");
 assert.equal(normalizeTitle("one two three four five six seven"),"one two three four five six");
 assert(normalizeTitle("a".repeat(100)).length<=48);
 assert.throws(()=>normalizeTitle("\n "));
});
