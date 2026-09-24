// Exercise the installed CLI's directory check without contacting a provider.
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { buildProviderInvocation } from '../core/providers';

const root = await mkdtemp(join(tmpdir(), 'j2code-folder-check-'));
try {
  const home = join(root, 'codex-home');
  const cwd = join(root, 'plain-folder');
  await mkdir(home);
  await mkdir(cwd);
  const invocation = buildProviderInvocation('codex', cwd, 'Reply OK. Do not use tools.');
  const result = spawnSync(invocation.command, [...invocation.args,
    '-c', 'model_provider="local_probe"',
    '-c', 'model_providers.local_probe.name="Offline probe"',
    '-c', 'model_providers.local_probe.base_url="http://127.0.0.1:1"',
    '-c', 'model_providers.local_probe.wire_api="responses"',
    '-c', 'model_providers.local_probe.request_max_retries=0',
    '-c', 'model_providers.local_probe.stream_max_retries=0',
  ], { cwd, env: { ...process.env, CODEX_HOME: home }, input: invocation.stdin, encoding: 'utf8', timeout: 8000 });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.doesNotMatch(output, /Not inside a trusted directory/, 'Ordinary project folders must pass the Codex directory check');
  assert.match(output, /thread.started/, 'CLI must start the session before the expected offline provider failure');
  console.log('PASS: ordinary folder passes directory check; provider endpoint was local and offline.');
} finally { await rm(root, { recursive: true, force: true }); }
