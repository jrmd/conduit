import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { ChangedFile, GitStatus, PRInput } from '../shared/api.js';
const exec = promisify(execFile);

async function command(bin: string, args: string[], cwd: string, options: { input?: string; maxBuffer?: number } = {}) {
  if (options.input !== undefined) throw new Error('Input is not supported by this command');
  const result = await exec(bin, args, { cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: options.maxBuffer ?? 4_000_000, windowsHide: true });
  return result.stdout.trimEnd();
}
async function git(cwd: string, ...args: string[]) { return command('git', ['--literal-pathspecs', ...args], cwd); }
async function root(cwd: string) { return git(cwd, 'rev-parse', '--show-toplevel'); }

export async function gitStatus(cwd: string): Promise<GitStatus> {
  try { cwd = await root(cwd); }
  catch { return { isRepository: false, branch: '', files: [], ahead: 0, behind: 0 }; }
  const [branch, raw, remote, remotes] = await Promise.all([
    git(cwd, 'branch', '--show-current'),
    git(cwd, 'status', '--porcelain=v1', '-z', '--untracked-files=all'),
    git(cwd, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}').catch(() => ''),
    git(cwd, 'remote').catch(() => '')
  ]);
  const files: ChangedFile[] = [];
  const records = raw.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record || record.length < 4) continue;
    const xy = record.slice(0, 2);
    const file = record.slice(3);
    const previousPath = xy.includes('R') || xy.includes('C') ? records[++i] : undefined;
    files.push({ path: file, ...(previousPath ? { previousPath } : {}), status: xy.trim() || 'M', staged: xy[0] !== ' ' && xy[0] !== '?', unstaged: xy[1] !== ' ' && xy[1] !== '?', untracked: xy === '??' });
  }
  let ahead = 0, behind = 0;
  if (remote) {
    const counts = (await git(cwd, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}')).split(/\s+/).map(Number);
    [ahead, behind] = counts;
  }
  const remoteNames = remotes.split('\n').filter(Boolean);
  let pushTarget: string | undefined;
  if (branch && remote) {
    const [remoteName, mergeRef] = await Promise.all([
      git(cwd, 'config', '--get', `branch.${branch}.remote`).catch(() => ''),
      git(cwd, 'config', '--get', `branch.${branch}.merge`).catch(() => '')
    ]);
    if (remoteName && mergeRef.startsWith('refs/heads/')) pushTarget = `${remoteName}/${mergeRef.slice('refs/heads/'.length)}`;
  } else if (branch) {
    const remoteName = remoteNames.includes('origin') ? 'origin' : remoteNames.length === 1 ? remoteNames[0] : undefined;
    if (remoteName) pushTarget = `${remoteName}/${branch}`;
  }
  return { isRepository: true, branch, files, ahead, behind, remote: remote || undefined, pushTarget };
}

async function requireChanged(cwd: string, files: string[]) {
  const status = await gitStatus(cwd);
  if (!status.isRepository) throw new Error('Project is not a Git repository');
  const allowed = new Set(status.files.map(file => file.path));
  if (!files.length || files.some(file => !allowed.has(file))) throw new Error('Select current changed files');
  return status;
}

export async function gitDiff(cwd: string, file: string) {
  cwd = await root(cwd);
  const status = await requireChanged(cwd, [file]);
  if (status.files.find(item => item.path === file)?.untracked) {
    const absolute = path.resolve(cwd, file);
    if (!absolute.startsWith(path.resolve(cwd) + path.sep)) throw new Error('Invalid path');
    const stat = await fs.lstat(absolute);
    if (!stat.isFile() || stat.size > 500_000) return 'Binary or large untracked file';
    return (await fs.readFile(absolute, 'utf8')).split('\n').map(line => `+${line}`).join('\n');
  }
  const headExists = await git(cwd, 'rev-parse', '--verify', 'HEAD').then(() => true, () => false);
  if (headExists) return git(cwd, 'diff', 'HEAD', '--', file);
  const [staged, unstaged] = await Promise.all([git(cwd, 'diff', '--cached', '--', file), git(cwd, 'diff', '--', file)]);
  return [staged, unstaged].filter(Boolean).join('\n');
}

export async function gitCommit(cwd: string, files: string[], message: string) {
  cwd = await root(cwd);
  await requireChanged(cwd, files);
  if (!message.trim() || message.length > 1000) throw new Error('Enter a commit message');
  // --only creates a commit from exactly these paths, preserving unrelated staged changes.
  // Intent-to-add makes selected untracked files eligible without staging their content.
  const status = await gitStatus(cwd);
  const untracked = files.filter(file => status.files.find(item => item.path === file)?.untracked);
  const commitPaths = [...new Set(files.flatMap(file => {
    const previousPath = status.files.find(item => item.path === file)?.previousPath;
    return previousPath ? [file, previousPath] : [file];
  }))];
  if (untracked.length) await git(cwd, 'add', '-N', '--', ...untracked);
  try { return await git(cwd, 'commit', '--only', '-m', message.trim(), '--', ...commitPaths); }
  catch (error) {
    if (untracked.length) {
      const hasHead = await git(cwd, 'rev-parse', '--verify', 'HEAD').then(() => true, () => false);
      if (hasHead) await git(cwd, 'reset', '-q', '--', ...untracked).catch(() => {});
      else await git(cwd, 'rm', '--cached', '-q', '--', ...untracked).catch(() => {});
    }
    throw error;
  }
}

export async function gitPush(cwd: string) {
  cwd = await root(cwd);
  const status = await gitStatus(cwd);
  if (!status.isRepository || !status.branch) throw new Error('A Git branch is required');
  if (!status.pushTarget) throw new Error('Configure a Git remote before pushing');
  const remote = status.remote
    ? await git(cwd, 'config', '--get', `branch.${status.branch}.remote`)
    : status.pushTarget.slice(0, -status.branch.length - 1);
  const destination = status.pushTarget.slice(remote.length + 1);
  return git(cwd, 'push', ...(status.remote ? [] : ['--set-upstream']), remote, `HEAD:refs/heads/${destination}`);
}

export async function createPullRequest(cwd: string, input: Omit<PRInput, 'projectId'>) {
  cwd = await root(cwd);
  const status = await gitStatus(cwd);
  if (!status.isRepository || !status.branch) throw new Error('A Git branch is required');
  if (!status.remote) throw new Error('Push this branch before creating a pull request');
  if (status.ahead > 0) throw new Error('Push local commits before creating a pull request');
  if (!input.title.trim()) throw new Error('Enter a pull request title');
  const bodyFile = path.join(os.tmpdir(), `j2code-pr-${randomUUID()}.md`);
  await fs.writeFile(bodyFile, input.body, { mode: 0o600 });
  try {
    const args = ['pr', 'create', '--title', input.title.trim(), '--body-file', bodyFile, '--head', status.branch];
    if (input.base?.trim()) args.push('--base', input.base.trim());
    if (input.draft) args.push('--draft');
    return await command('gh', args, cwd);
  } finally { await fs.rm(bodyFile, { force: true }); }
}
