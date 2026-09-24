import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildProviderInvocation, discoverModels, parseClaudeModels, normalizeModelId, parseListedModels, parseProviderOutputLine, runProvider } from './providers';

describe('provider CLI invocation', () => {
  it('starts Codex in the selected project and resumes only the supplied session', () => {
    assert.deepEqual(buildProviderInvocation('codex', '/work/project', 'fix it'), {
      command: 'codex', args: ['exec', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"'], stdin: 'fix it',
    });
    assert.deepEqual(buildProviderInvocation('codex', '/work/project', 'continue', 'thread-123', 'edit'), {
      command: 'codex', args: ['exec', 'resume', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="never"', 'thread-123', '-'], stdin: 'continue',
    });
  });

  it('passes prompts and explicit resume ids as argv for the other providers', () => {
    assert.deepEqual(buildProviderInvocation('claude', '/work/project', 'a prompt with spaces', 'claude-session'), {
      command: 'claude', args: ['--print', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--forward-subagent-text', '--permission-mode', 'plan', '--resume', 'claude-session'], stdin: 'a prompt with spaces',
    });
    assert.deepEqual(buildProviderInvocation('cursor', '/work/project', 'hello', 'cursor-session'), {
      command: 'cursor-agent', args: ['--print', '--output-format', 'stream-json', '--resume', 'cursor-session', '--', 'hello'],
    });
    assert.deepEqual(buildProviderInvocation('opencode', '/work/project', 'hello', 'oc-1'), {
      command: 'opencode', args: ['run', '--format', 'json', '--thinking', '--dir', '/work/project', '--session', 'oc-1', '--', 'hello'],
    });
  });

  it('forwards selected model IDs on new and resumed turns for every CLI', () => {
    for (const provider of ['codex', 'claude', 'cursor', 'opencode'] as const) {
      const fresh = buildProviderInvocation(provider, '/work/project', 'hello', undefined, 'edit', 'gpt-6-sol');
      const resumed = buildProviderInvocation(provider, '/work/project', 'continue', 'session-123', 'edit', 'gpt-6-luna');
      assert.deepEqual(fresh.args.slice(fresh.args.indexOf('--model'), fresh.args.indexOf('--model') + 2), ['--model', 'gpt-6-sol']);
      assert.deepEqual(resumed.args.slice(resumed.args.indexOf('--model'), resumed.args.indexOf('--model') + 2), ['--model', 'gpt-6-luna']);
      assert.ok(resumed.args.includes('session-123'));
    }
    assert.equal(normalizeModelId('  openrouter/claude:sonnet-4  '), 'openrouter/claude:sonnet-4');
    assert.equal(normalizeModelId(''), undefined);
    assert.throws(() => normalizeModelId('--dangerously-bypass'), /Invalid model ID/);
    assert.throws(() => normalizeModelId('gpt-6-sol\n--dangerously-bypass'), /Invalid model ID/);
  });
});

describe('model catalogues', () => {
  it('reads only visible Codex model fields from the local cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'j2code-model-cache-'));
    const original = process.env.CODEX_HOME;
    try {
      await writeFile(join(dir, 'models_cache.json'), JSON.stringify({ identity: { secret: 'never expose' }, models: [
        { slug: 'gpt-6-luna', display_name: 'GPT-6 Luna', visibility: 'list', priority: 3, secret: 'never expose' },
        { slug: 'gpt-6-sol', display_name: 'GPT-6 Sol', visibility: 'list', priority: 2 },
        { slug: 'hidden-model', display_name: 'Hidden', visibility: 'hide', priority: 1 }
      ] }));
      process.env.CODEX_HOME = dir;
      const catalogue = await discoverModels('codex');
      assert.deepEqual(catalogue.options, [
        { id: 'gpt-6-sol', label: 'GPT-6 Sol', source: 'discovered' },
        { id: 'gpt-6-luna', label: 'GPT-6 Luna', source: 'discovered' }
      ]);
      assert.equal(JSON.stringify(catalogue).includes('never expose'), false);
      assert.equal(JSON.stringify(catalogue).includes('hidden-model'), false);
    } finally {
      if (original === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = original;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses only Claude capability fields, never account identity or unsupported effort guesses', () => {
    const output = JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'j2code-model-capabilities', response: { account: { secret: 'never expose' }, models: [
      { value: 'opus[1m]', displayName: 'Opus', supportsEffort: true, supportedEffortLevels: ['low', 'max'], secret: 'never expose' },
      { value: 'haiku', displayName: 'Haiku', supportsEffort: false }
    ] } } });
    const models = parseClaudeModels(output);
    assert.deepEqual(models, [{ id: 'opus[1m]', label: 'Opus', source: 'discovered', efforts: ['low', 'max'] }, { id: 'haiku', label: 'Haiku', source: 'discovered' }]);
    assert.equal(JSON.stringify(models).includes('never expose'), false);
  });

  it('parses Cursor model rows while ignoring headers, ANSI and footer text', () => {
    const listing = '\x1b[36mAvailable models\x1b[0m\n\n' +
      'auto - Auto\ncomposer-1.5 - Composer 1.5\ngpt-5.3-codex-low - GPT-5.3 Codex Low\n' +
      'Sign in for more models\nUse --model to choose\n';
    assert.deepEqual(parseListedModels(listing, 'cursor'), [
      { id: 'auto', label: 'Auto', source: 'discovered' },
      { id: 'composer-1.5', label: 'Composer 1.5', source: 'discovered' },
      { id: 'gpt-5.3-codex-low', label: 'GPT-5.3 Codex Low', source: 'discovered' }
    ]);
  });

  it('lists OpenCode models through the installed CLI without provider API calls', async () => {
    if (process.platform === 'win32') return;
    const dir = await mkdtemp(join(tmpdir(), 'j2code-opencode-models-'));
    const original = process.env.PATH;
    try {
      const cli = join(dir, 'opencode');
      await writeFile(cli, `#!${process.execPath}\nif(process.argv[2]==='models') process.stdout.write('openai/gpt-6-sol\\nopenai/gpt-6-luna\\n'); else process.exit(2);\n`);
      await chmod(cli, 0o755);
      process.env.PATH = `${dir}:${original || ''}`;
      const catalogue = await discoverModels('opencode');
      assert.deepEqual(catalogue.options.map(item => item.id), ['openai/gpt-6-sol', 'openai/gpt-6-luna']);
    } finally {
      if (original === undefined) delete process.env.PATH; else process.env.PATH = original;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('provider event parsing', () => {
  it('extracts Codex thread id, assistant text, tool event, and terminal status', () => {
    assert.deepEqual(parseProviderOutputLine('codex', '{"type":"thread.started","thread_id":"t-1"}'), [
      { kind: 'status', text: 'Session started', sessionId: 't-1' },
    ]);
    assert.deepEqual(parseProviderOutputLine('codex', '{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}'), [
      { kind: 'text', text: 'Done' },
    ]);
    assert.deepEqual(parseProviderOutputLine('codex', '{"type":"turn.completed"}'), [
      { kind: 'status', text: 'Turn completed' },
    ]);
  });

  it('parses Claude streamed content and OpenCode JSON events', () => {
    assert.deepEqual(parseProviderOutputLine('claude', '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}}'), [
      { kind: 'text', text: 'partial' },
    ]);
    assert.deepEqual(parseProviderOutputLine('claude', '{"type":"assistant","session_id":"s-1","message":{"content":[{"type":"text","text":"hello"},{"type":"tool_use","name":"Read"}]}}'), [
      { kind: 'text', text: 'hello', sessionId: 's-1' },
      { kind: 'tool', text: 'Read', sessionId: 's-1' },
    ]);
    assert.deepEqual(parseProviderOutputLine('opencode', '{"type":"text","sessionID":"oc-1","part":{"text":"world"}}'), [
      { kind: 'text', text: 'world', sessionId: 'oc-1' },
    ]);
  });

  it('classifies authentication failures and preserves plain text output', () => {
    assert.deepEqual(parseProviderOutputLine('cursor', 'Please log in to continue'), [
      { kind: 'error', text: 'Please log in to continue' },
    ]);
    assert.deepEqual(parseProviderOutputLine('opencode', 'plain response'), [
      { kind: 'text', text: 'plain response' },
    ]);
    assert.deepEqual(parseProviderOutputLine('opencode', 'null'), []);
    assert.deepEqual(parseProviderOutputLine('opencode', '[]'), []);
    assert.deepEqual(parseProviderOutputLine('claude', '{"type":"assistant","message":{"content":{}}}'), []);
    assert.deepEqual(parseProviderOutputLine('cursor', '{"type":"user","text":"user input"}'), []);
    assert.deepEqual(parseProviderOutputLine('cursor', '{"type":"result","is_error":true,"result":"failed"}'), [
      { kind: 'error', text: 'failed' },
    ]);
  });
});

describe('provider process runner', () => {
  it('passes prompts through stdin, applies the project cwd, and resolves the session id', async () => {
    if (process.platform === 'win32') return;
    const root = await mkdtemp(join(tmpdir(), 'j2code-provider-'));
    const bin = join(root, 'bin');
    const project = join(root, 'project');
    await mkdir(bin);
    await mkdir(project);
    const cli = join(bin, 'codex');
    await writeFile(cli, `#!${process.execPath}\nlet input = ''; for await (const chunk of process.stdin) input += chunk; process.stdout.write(JSON.stringify({type:'thread.started',thread_id:'new-session'})+'\\n'); process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:input+' @ '+process.cwd()}})+'\\n'); process.stdout.write(JSON.stringify({type:'turn.completed'})+'\\n');\n`);
    await chmod(cli, 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${bin}${process.env.PATH ? `:${process.env.PATH}` : ''}`;
    const controller = new AbortController();
    const events: { kind: string; text: string; sessionId?: string }[] = [];
    try {
      const result = await runProvider({
        provider: 'codex', cwd: project, prompt: '-leading prompt', mode: 'read', signal: controller.signal,
        onEvent: value => events.push(value),
      });
      assert.deepEqual(result, { sessionId: 'new-session' });
      assert.ok(events.some(value => value.text === `-leading prompt @ ${project}`));
      assert.ok(events.some(value => value.text === 'Turn completed'));
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects structured provider errors even when the CLI exits successfully', async () => {
    if (process.platform === 'win32') return;
    const root = await mkdtemp(join(tmpdir(), 'j2code-provider-error-'));
    const bin = join(root, 'bin');
    await mkdir(bin);
    const cli = join(bin, 'codex');
    await writeFile(cli, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({type:'turn.failed',message:'The provider rejected the request'})+'\\n');\n`);
    await chmod(cli, 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${bin}${process.env.PATH ? `:${process.env.PATH}` : ''}`;
    const controller = new AbortController();
    const events: { kind: string; text: string }[] = [];
    try {
      await assert.rejects(runProvider({
        provider: 'codex', cwd: root, prompt: 'hello', signal: controller.signal,
        onEvent: value => events.push(value),
      }), /The provider rejected the request/);
      assert.ok(events.some(value => value.kind === 'error' && value.text === 'The provider rejected the request'));
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('kills the entire process group, including a child that ignores SIGTERM', async () => {
    if (process.platform === 'win32') return;
    const root = await mkdtemp(join(tmpdir(), 'j2code-provider-cancel-'));
    const bin = join(root, 'bin');
    await mkdir(bin);
    const cli = join(bin, 'codex');
    const childCode = `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`;
    await writeFile(cli, `#!${process.execPath}\nconst {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'}); process.stdout.write(JSON.stringify({type:'thread.started',thread_id:'cancel-me'})+'\\n'); process.stdout.write(JSON.stringify({type:'item.started',item:{type:'command_execution',command:String(c.pid)}})+'\\n'); setInterval(()=>{},1000);\n`);
    await chmod(cli, 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${bin}${process.env.PATH ? `:${process.env.PATH}` : ''}`;
    const controller = new AbortController();
    let descendantPid: number | undefined;
    try {
      const execution = runProvider({
        provider: 'codex', cwd: root, prompt: 'cancel me', signal: controller.signal,
        onEvent: value => {
          if (value.kind === 'tool' && /^\d+$/.test(value.text)) {
            descendantPid = Number(value.text);
            controller.abort();
          }
        },
      });
      await assert.rejects(execution, { name: 'AbortError' });
      assert.ok(descendantPid);
      let state = '';
      try { state = execFileSync('ps', ['-o', 'stat=', '-p', String(descendantPid)], { encoding: 'utf8' }).trim(); }
      catch { /* no process with this id means it was reaped */ }
      assert.ok(!state || state.startsWith('Z'), `descendant is still running with state ${state}`);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      await rm(root, { recursive: true, force: true });
    }
  });
});
