import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Questions } from './questions';
import { handoffBrief, planSteps, stepsFromMarkdown } from './planning';
import { Store } from './store';

test('questions validate ownership and choices, resolve once, and clear on cancellation', async () => {
  const questions = new Questions(() => {});
  const controller = new AbortController();
  const qs = [{ id:'choice', text:'Storage?', options:[{value:'sqlite',label:'SQLite'}] }];
  const pending = questions.ask('thread', qs, controller.signal);
  const id = questions.list()[0].id;
  assert.throws(() => questions.respond(id, 'other', {choice:['sqlite']}), /no longer pending/);
  assert.throws(() => questions.respond(id, 'thread', {choice:['invented']}), /Answer every/);
  questions.respond(id, 'thread', {choice:['sqlite']});
  assert.deepEqual(await pending, {choice:['sqlite']});
  assert.throws(() => questions.respond(id, 'thread', null), /no longer pending/);
  const cancelled = questions.ask('thread', qs, controller.signal);
  controller.abort();
  assert.equal(await cancelled, null);
  assert.equal(questions.list().length, 0);
  assert.equal(await questions.ask('thread', qs, controller.signal), null);
});

test('native checklists normalize and complete plan survives persistence and provider changes in a fresh thread', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'conduit-plan-'));
  try {
    const store = new Store(join(dir,'state.json'));
    const project = await store.addProject(dir);
    const source = await store.createThread(project.id,'codex','supervised');
    const steps = planSteps([{step:'Inspect parser',status:'completed'},{content:'Implement parser',status:'inProgress'}]);
    await store.updateThread(source.id, {sessionId:'old-context',planning:true,plan:{steps,brief:'Goal: parse inputs. Decision: preserve API. Files: parser.ts. Validate with pnpm test.'}});
    const brief = handoffBrief(store.getThread(source.id),dir);
    assert.match(brief,/\[x\] Inspect parser/);
    assert.match(brief,/preserve API/);
    const fresh = await store.createThread(project.id,'claude','auto-edits',undefined,undefined,{path:dir,mode:'local'});
    await store.updateThread(fresh.id,{plan:structuredClone(store.getThread(source.id).plan),handoff:brief,sourceThreadId:source.id});
    await store.configureThread(fresh.id,{provider:'cursor',mode:'supervised'});
    const restored = new Store(join(dir,'state.json')); await restored.load();
    const thread = restored.getThread(fresh.id);
    assert.equal(thread.sessionId,undefined); assert.deepEqual(thread.messages,[]);
    assert.equal(thread.provider,'cursor'); assert.equal(thread.workspace?.path,dir);
    assert.equal(thread.handoff,brief); assert.deepEqual(thread.plan?.steps,steps);
    assert.deepEqual(stepsFromMarkdown('1. Implement\n- [x] Validate'),[{text:'Implement',status:'pending'},{text:'Validate',status:'completed'}]);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
