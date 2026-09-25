import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { commitContext, pullRequestContext, gitCommit, gitDiff, gitPush, gitStatus } from './git.js';
import { normalizeCommitMessage } from './thread-title.js';

function git(cwd: string, ...args: string[]) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
async function repo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2code-git-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.name', 'J2 Test');
  git(dir, 'config', 'user.email', 'j2@example.invalid');
  await writeFile(path.join(dir, 'selected.txt'), 'base\n');
  await writeFile(path.join(dir, 'unrelated.txt'), 'base\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'initial');
  return dir;
}

test('selected commit excludes unrelated staged content and preserves its index entry', async () => {
  const dir = await repo();
  try {
    await writeFile(path.join(dir, 'selected.txt'), 'selected\n');
    await writeFile(path.join(dir, 'unrelated.txt'), 'staged elsewhere\n');
    git(dir, 'add', 'unrelated.txt');
    const status = await gitStatus(dir);
    assert.equal(status.files.length, 2);
    await gitCommit(dir, ['selected.txt'], 'selected only');
    assert.equal(git(dir, 'show', 'HEAD:selected.txt'), 'selected');
    assert.equal(git(dir, 'show', 'HEAD:unrelated.txt'), 'base');
    assert.equal(git(dir, 'diff', '--cached', '--name-only'), 'unrelated.txt');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('literal pathspec and nested project paths cannot select another file', async () => {
  const dir = await repo();
  try {
    await writeFile(path.join(dir, ':(glob)*'), 'literal\n');
    await writeFile(path.join(dir, 'selected.txt'), 'changed\n');
    await mkdir(path.join(dir, 'sub'));
    const status = await gitStatus(path.join(dir, 'sub'));
    assert(status.files.some(file => file.path === ':(glob)*'));
    await gitCommit(path.join(dir, 'sub'), [':(glob)*'], 'literal filename');
    assert.equal(git(dir, 'show', 'HEAD::(glob)*'), 'literal');
    assert.equal(git(dir, 'show', 'HEAD:selected.txt'), 'base');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('unborn repository shows a diff and commits a selected new file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'j2code-unborn-'));
  try {
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.name', 'J2 Test');
    git(dir, 'config', 'user.email', 'j2@example.invalid');
    await writeFile(path.join(dir, 'new.txt'), 'hello\n');
    assert.match(await gitDiff(dir, 'new.txt'), /hello/);
    await gitCommit(dir, ['new.txt'], 'initial');
    assert.equal(git(dir, 'show', 'HEAD:new.txt'), 'hello');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('selected staged rename commits both its new name and old deletion', async () => {
  const dir = await repo();
  try {
    await rename(path.join(dir, 'selected.txt'), path.join(dir, 'renamed.txt'));
    git(dir, 'add', '-A');
    const change = (await gitStatus(dir)).files.find(file => file.path === 'renamed.txt');
    assert.equal(change?.previousPath, 'selected.txt');
    await gitCommit(dir, ['renamed.txt'], 'rename');
    assert.equal(git(dir, 'show', 'HEAD:renamed.txt'), 'base');
    assert.equal(git(dir, 'ls-tree', '--name-only', 'HEAD').includes('selected.txt'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('push publishes only the current branch even with push.default=matching', async () => {
  const dir = await repo();
  const bare = await mkdtemp(path.join(tmpdir(), 'j2code-remote-'));
  try {
    git(bare, 'init', '--bare', '-q');
    git(dir, 'remote', 'add', 'origin', bare);
    const primary = git(dir, 'branch', '--show-current');
    git(dir, 'push', '-q', '--set-upstream', 'origin', primary);
    git(dir, 'checkout', '-qb', 'other');
    git(dir, 'push', '-q', '--set-upstream', 'origin', 'other');
    await writeFile(path.join(dir, 'other.txt'), 'local only\n');
    git(dir, 'add', 'other.txt'); git(dir, 'commit', '-qm', 'other local');
    git(dir, 'checkout', '-q', primary);
    await writeFile(path.join(dir, 'selected.txt'), 'primary local\n');
    git(dir, 'add', 'selected.txt'); git(dir, 'commit', '-qm', 'primary local');
    git(dir, 'config', 'push.default', 'matching');
    await gitPush(dir);
    assert.equal(git(bare, 'rev-parse', `refs/heads/${primary}`), git(dir, 'rev-parse', primary));
    assert.notEqual(git(bare, 'rev-parse', 'refs/heads/other'), git(dir, 'rev-parse', 'other'));
  } finally { await rm(dir, { recursive: true, force: true }); await rm(bare, { recursive: true, force: true }); }
});

test('commit context covers only chosen files, includes new files and truncates large diffs', async () => {
  const dir = await repo();
  try {
    await writeFile(path.join(dir, 'selected.txt'), 'selected\n');
    await writeFile(path.join(dir, 'unrelated.txt'), 'secret unrelated change\n');
    await writeFile(path.join(dir, 'new.txt'), 'brand new\n');
    const context = await commitContext(dir, ['selected.txt', 'new.txt']);
    assert.match(context.files, /M selected\.txt/);
    assert.match(context.files, /A new\.txt/);
    assert.match(context.diff, /\+selected/);
    assert.match(context.diff, /New file: new\.txt\n\+brand new/);
    assert.doesNotMatch(context.diff, /unrelated/);
    assert.equal(context.recent, 'initial');
    const small = await commitContext(dir, ['selected.txt'], 20);
    assert.match(small.diff, /diff truncated\)$/);
    await assert.rejects(commitContext(dir, ['missing.txt']), /Select current changed files/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('commit messages keep subject and body without wrappers', () => {
  assert.equal(normalizeCommitMessage('```\nAdd commit generation.\n\nExplain why.\n```'), 'Add commit generation\n\nExplain why.');
  assert.equal(normalizeCommitMessage('Commit message: "Fix sidebar"'), 'Fix sidebar');
  assert.throws(() => normalizeCommitMessage('  '), /no commit message/);
});


test('first commit context describes the working file, including edits after staging', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'conduit-first-context-'));
  try {
    git(dir, 'init', '-q');
    await writeFile(path.join(dir, 'new.txt'), 'staged version\n');
    git(dir, 'add', 'new.txt');
    await writeFile(path.join(dir, 'new.txt'), 'working version\n');
    const context = await commitContext(dir, ['new.txt']);
    assert.match(context.diff, /\+working version/);
    assert.doesNotMatch(context.diff, /staged version/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('feature branch commit leaves main unchanged and pushes the new branch', async () => {
  const dir = await repo();
  const bare = await mkdtemp(path.join(tmpdir(), 'j2code-feature-remote-'));
  try {
    git(dir, 'branch', '-M', 'main');
    const original = git(dir, 'rev-parse', 'main');
    git(bare, 'init', '--bare', '-q');
    git(dir, 'remote', 'add', 'origin', bare);
    await writeFile(path.join(dir, 'selected.txt'), 'feature change\n');
    await assert.rejects(gitCommit(dir, ['selected.txt'], 'Add feature', 'bad branch'));
    assert.equal(git(dir, 'branch', '--show-current'), 'main');
    await gitCommit(dir, ['selected.txt'], 'Add feature', 'feature/change');
    await gitPush(dir);
    assert.equal(git(dir, 'rev-parse', 'main'), original);
    assert.equal((await gitStatus(dir)).remote, 'origin/feature/change');
    assert.equal(git(bare, 'rev-parse', 'refs/heads/feature/change'), git(dir, 'rev-parse', 'HEAD'));
  } finally { await rm(dir, { recursive: true, force: true }); await rm(bare, { recursive: true, force: true }); }
});

test('PR context describes committed branch range and discovers GitHub templates', async () => {
  const dir = await repo();
  try {
    git(dir, 'branch', '-M', 'main');
    await assert.rejects(pullRequestContext(dir), /feature branch/);
    git(dir, 'switch', '-c', 'feature/example');
    await writeFile(path.join(dir, 'selected.txt'), 'committed feature\n');
    await gitCommit(dir, ['selected.txt'], 'Implement feature');
    await writeFile(path.join(dir, 'selected.txt'), 'uncommitted secret\n');
    await mkdir(path.join(dir, '.github', 'PULL_REQUEST_TEMPLATE'), { recursive: true });
    await writeFile(path.join(dir, '.github', 'PULL_REQUEST_TEMPLATE', 'feature.md'), '## Summary\n## Testing\n- [ ] Checked');
    const context = await pullRequestContext(dir);
    assert.equal(context.base, 'main');
    assert.match(context.diff, /committed feature/);
    assert.doesNotMatch(context.diff, /uncommitted secret/);
    assert.equal(context.commits, 'Implement feature');
    assert.equal(context.templatePath, '.github/PULL_REQUEST_TEMPLATE/feature.md');
    assert.match(context.template, /## Testing/);
    await writeFile(path.join(dir, '.github', 'pull_request_template.md'), '## Default');
    assert.equal((await pullRequestContext(dir)).template, '## Default');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
