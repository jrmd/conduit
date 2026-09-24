import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from './store';
import { threadGitContext } from './git';

it('captures branch/repository independently of later checkout and persists summary/settlement', async () => {
 const dir=await mkdtemp(path.join(tmpdir(),'vulp-thread-meta-'));
 try {
  execFileSync('git',['init','-b','feature/original'],{cwd:dir});
  execFileSync('git',['remote','add','origin','git@github.com:jrmd/vulp.git'],{cwd:dir});
  assert.deepEqual(await threadGitContext(dir),{branch:'feature/original',repository:'https://github.com/jrmd/vulp'});
  const file=path.join(dir,'state.json'),store=new Store(file);await store.load();const project=await store.addProject(dir);const thread=await store.createThread(project.id,'codex','read');
  await store.updateThread(thread.id,{...await threadGitContext(dir),branches:['feature/original'],summary:'Fixed the parser.',settled:true});
  execFileSync('git',['checkout','--orphan','feature/later'],{cwd:dir});
  const reopened=new Store(file);await reopened.load();const saved=reopened.getThread(thread.id);
  assert.equal(saved.branch,'feature/original');assert.equal(saved.settled,true);assert.equal(saved.summary,'Fixed the parser.');
  assert.equal((await threadGitContext(dir)).branch,'feature/later');
  execFileSync('git',['remote','set-url','origin','https://credential@github.com/jrmd/vulp.git'],{cwd:dir});
  assert.equal((await threadGitContext(dir)).repository,undefined);
 } finally {await rm(dir,{recursive:true,force:true})}
});
