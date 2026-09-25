import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { prepareWorkspace, workspaceInfo } from './workspaces';
import { Store } from './store';
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
test('workspace selection isolates dirty checkout, persists, and switches local branches safely', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'conduit-workspaces-'));
  const repo = path.join(temp, 'repo'), worktrees = path.join(temp, 'worktrees');
  try {
    await mkdir(repo); git(repo, 'init', '-qb', 'main');
    await writeFile(path.join(repo, 'file.txt'), 'committed');
    git(repo, 'add', '.'); git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base');
    git(repo, 'branch', 'existing');
    await writeFile(path.join(repo, 'file.txt'), 'dirty');
    await assert.rejects(prepareWorkspace(repo, { mode: 'local', branch: 'existing' }, worktrees), /Commit or stash/);
    const workspace = await prepareWorkspace(repo, { mode: 'worktree', branch: 'main', newBranch: 'feature/task' }, worktrees);
    assert.equal(git(repo, 'branch', '--show-current'), 'main');
    assert.equal(git(workspace.path, 'branch', '--show-current'), 'feature/task');
    assert.equal(await readFile(path.join(repo, 'file.txt'), 'utf8'), 'dirty');
    assert.equal(await readFile(path.join(workspace.path, 'file.txt'), 'utf8'), 'committed');
    const store = new Store(path.join(temp, 'state.json'));
    const project = await store.addProject(repo);
    const thread = await store.createThread(project.id, 'codex', 'supervised', undefined, undefined, workspace);
    const restored = new Store(path.join(temp, 'state.json')); await restored.load();
    assert.deepEqual(restored.getThread(thread.id).workspace, workspace);
    await assert.rejects(prepareWorkspace(repo, { mode: 'worktree', newBranch: 'feature/task' }, worktrees));
    await assert.rejects(prepareWorkspace(repo, { mode: 'worktree', newBranch: '--bad' }, worktrees), /Invalid branch/);
    await assert.rejects(prepareWorkspace(repo, { mode: 'worktree' }, worktrees), /Name the new/);
    await writeFile(path.join(repo, 'file.txt'), 'committed');
    await prepareWorkspace(repo, { mode: 'local', branch: 'existing' }, worktrees);
    assert.equal((await workspaceInfo(repo)).current, 'existing');
    await prepareWorkspace(repo, { mode: 'local', newBranch: 'local-task' }, worktrees);
    assert.equal((await workspaceInfo(repo)).current, 'local-task');
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test('plain directories remain usable and unborn repositories reject worktrees', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'conduit-workspaces-'));
  try {
    assert.equal((await workspaceInfo(temp)).isRepository, false);
    assert.equal((await prepareWorkspace(temp, { mode: 'local' }, temp)).path, temp);
    await assert.rejects(prepareWorkspace(temp, { mode: 'worktree', newBranch: 'task' }, temp));
    git(temp, 'init', '-qb', 'main');
    await assert.rejects(prepareWorkspace(temp, { mode: 'worktree', newBranch: 'task' }, temp));
    assert.equal(git(temp, 'branch', '--show-current'), 'main');
  } finally { await rm(temp, { recursive: true, force: true }); }
});
