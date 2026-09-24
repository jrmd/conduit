import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WorkspaceChoice, WorkspaceInfo, ThreadWorkspace } from '../shared/api';
const exec = promisify(execFile);
async function git(cwd: string, ...args: string[]) {
  return (await exec('git', args, { cwd, encoding: 'utf8', timeout: 30_000 })).stdout.trim();
}
export async function workspaceInfo(cwd: string): Promise<WorkspaceInfo> {
  try { await git(cwd, 'rev-parse', '--show-toplevel'); }
  catch { return { isRepository: false, current: '', branches: [] }; }
  const [current, branches] = await Promise.all([
    git(cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD').catch(() => ''),
    git(cwd, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/')
  ]);
  return { isRepository: true, current, branches: branches.split('\n').filter(Boolean) };
}
export async function prepareWorkspace(cwd: string, choice: WorkspaceChoice | undefined, directory: string): Promise<ThreadWorkspace> {
  if (!choice) return { path: cwd, mode: 'local' };
  if (!['local', 'worktree'].includes(choice.mode)) throw new Error('Choose a workspace');
  for (const value of [choice.branch, choice.newBranch]) {
    if (value !== undefined && (typeof value !== 'string' || value.length > 200 || value.startsWith('-'))) throw new Error('Invalid branch name');
    if (value) await git(cwd, 'check-ref-format', '--branch', value);
  }
  const info = await workspaceInfo(cwd);
  if (!info.isRepository) {
    if (choice.mode !== 'local' || choice.branch || choice.newBranch) throw new Error('A Git repository is required');
    return { path: cwd, mode: 'local' };
  }
  const base = choice.branch || info.current;
  if (choice.branch && choice.branch !== info.current && !info.branches.includes(choice.branch)) throw new Error('The selected branch no longer exists');
  if (choice.mode === 'local') {
    if (choice.newBranch || (base && base !== info.current)) {
      if (await git(cwd, 'status', '--porcelain')) throw new Error('Commit or stash local changes before switching branches, or choose a new worktree');
      await git(cwd, 'switch', ...(choice.newBranch ? ['-c', choice.newBranch, ...(base ? [base] : [])] : [base]));
    }
    return { path: cwd, mode: 'local' };
  }
  if (!choice.newBranch?.trim()) throw new Error('Name the new worktree branch');
  const root = await git(cwd, 'rev-parse', '--show-toplevel');
  const commit = await git(cwd, 'rev-parse', '--verify', `${base ? `refs/heads/${base}` : 'HEAD'}^{commit}`);
  const relative = path.relative(root, cwd);
  if (relative && await git(root, 'cat-file', '-t', `${commit}:${relative.split(path.sep).join('/')}`) !== 'tree') throw new Error('Project directory is missing in the selected branch');
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, randomUUID());
  await git(root, 'worktree', 'add', '-b', choice.newBranch, target, commit);
  const workspacePath = path.join(target, relative);
  if (!(await stat(workspacePath)).isDirectory()) throw new Error('Project directory is missing in the selected branch');
  return { path: workspacePath, mode: 'worktree' };
}
