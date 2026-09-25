import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from './store.js';

test('projects, threads, messages, and explicit provider session survive restart', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2code-store-'));
  try {
    const file = path.join(dir, 'data', 'state.json');
    const first = new Store(file);
    await first.load();
    const project = await first.addProject(dir);
    assert.equal((await first.addProject(dir)).id, project.id);
    const thread = await first.createThread(project.id, 'codex', 'edit', 'gpt-6-sol');
    await first.appendMessage(thread.id, 'user', 'Refactor the parser');
    await first.appendMessage(thread.id, 'assistant', 'Done.');
    await first.updateThread(thread.id, { sessionId: 'provider-session-123' });
    await first.updateThread(thread.id, { model: 'gpt-6-luna' });
    const second = new Store(file);
    await second.load();
    const persisted = second.getThread(thread.id);
    assert.equal(persisted.title, 'Refactor the parser');
    assert.equal(persisted.provider, 'codex');
    assert.equal(persisted.mode, 'edit');
    assert.equal(persisted.model, 'gpt-6-luna');
    assert.equal(persisted.sessionId, 'provider-session-123');
    assert.deepEqual(persisted.messages.map(message => message.text), ['Refactor the parser', 'Done.']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('provider preferences survive restart without removing existing threads', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2code-preferences-'));
  try {
    const file = path.join(dir, 'state.json');
    const store = new Store(file);
    await store.load();
    assert.deepEqual(store.snapshot().disabledProviders, []);
    const project = await store.addProject(dir);
    const thread = await store.createThread(project.id, 'codex', 'read');
    await store.setProviderEnabled('codex', false);
    await store.setProviderEnabled('claude', false);
    const restored = new Store(file);
    await restored.load();
    assert.deepEqual(restored.snapshot().disabledProviders, ['codex', 'claude']);
    assert.equal(restored.getThread(thread.id).provider, 'codex');
    await restored.setProviderEnabled('codex', true);
    const enabled = new Store(file);
    await enabled.load();
    assert.deepEqual(enabled.snapshot().disabledProviders, ['claude']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('permissions can change on a resumed thread while provider stays locked', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vulp-mode-'));
  try {
    const store = new Store(path.join(dir, 'state.json')); await store.load();
    const project = await store.addProject(dir);
    const thread = await store.createThread(project.id, 'codex', 'read');
    await store.appendMessage(thread.id, 'user', 'Inspect this project');
    await store.updateThread(thread.id, {sessionId:'session'});
    await store.configureThread(thread.id, {provider:'codex',mode:'edit'});
    assert.equal(store.getThread(thread.id).mode, 'edit');
    await store.configureThread(thread.id, {provider:'codex',mode:'read'});
    await assert.rejects(store.configureThread(thread.id, {provider:'claude',mode:'read'}));
    const restored = new Store(path.join(dir,'state.json')); await restored.load();
    assert.equal(restored.getThread(thread.id).mode,'read');
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('pinning survives restart and preserves activity order', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vulp-pins-'));
  try {
    const file = path.join(dir, 'state.json');
    const store = new Store(file); await store.load();
    const project = await store.addProject(dir);
    const thread = await store.createThread(project.id, 'codex', 'read');
    await store.pinThread(thread.id, true);
    const restored = new Store(file); await restored.load();
    assert.equal(restored.getThread(thread.id).pinned, true);
    assert.equal(restored.getThread(thread.id).updatedAt, thread.updatedAt);
    await restored.pinThread(thread.id, false);
    const unpinned = new Store(file); await unpinned.load();
    assert.equal(unpinned.getThread(thread.id).pinned, false);
    assert.equal(unpinned.getThread(thread.id).updatedAt, thread.updatedAt);
    await assert.rejects(() => store.pinThread('missing', true));
  } finally { await rm(dir, {recursive:true, force:true}); }
});


test('queue metadata survives restart and dispatch persists the message and dequeue together', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'conduit-queue-store-'));
  try {
    const file = path.join(dir, 'state.json');
    const store = new Store(file);
    const project = await store.addProject(dir);
    const thread = await store.createThread(project.id, 'codex', 'supervised');
    const pending = [
      { id: 'first', text: 'First', attachments: ['attachment-id'], references: ['file:source.ts'] },
      { id: 'second', text: 'Second', attachments: [], references: [] },
    ];
    await store.updateThread(thread.id, { queuedMessages: pending });
    const reloaded = new Store(file); await reloaded.load();
    assert.deepEqual(reloaded.getThread(thread.id).queuedMessages, pending);
    await reloaded.appendMessage(thread.id, 'user', 'First', [], 'first');
    const dispatched = new Store(file); await dispatched.load();
    assert.deepEqual(dispatched.getThread(thread.id).queuedMessages, [pending[1]]);
    assert.deepEqual(dispatched.getThread(thread.id).messages.map(message => message.text), ['First']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
