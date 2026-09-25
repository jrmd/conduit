import { ProviderRpc } from './provider-rpc';
import type { ProviderTool } from './delegation';
import { runInteractiveProvider } from './interactive-provider';
import { createClaudeTextStream } from './response-stream';
import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { delimiter, join } from 'node:path';
import { access, constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { homedir } from 'node:os';
import crossSpawn from 'cross-spawn';
import { watchCodexActivity } from './codex-activity';
import { prepareAttachments, type ResolvedAttachment } from './attachments';
import { createActivityParser } from './activity';
import type { ActivityUpdate, ModelCatalogue, ModelOption, ProviderId, ProviderInfo, ThreadMode } from '../shared/api';

export interface ProviderRunEvent {
  kind: 'text' | 'status' | 'error' | 'tool' | 'activity';
  activity?: ActivityUpdate;
  text: string;
  sessionId?: string;
}

export interface RunProviderArgs {
  tools?: readonly ProviderTool[];
  readOnlyChild?: boolean;
  attachments?: ResolvedAttachment[];
  provider: ProviderId;
  cwd: string;
  prompt: string;
  sessionId?: string;
  mode?: ThreadMode;
  onApproval?: (title: string, detail: string) => Promise<boolean>;
  model?: string;
  effort?: string;
  contextWindow?: number;
  fastMode?: boolean;
  signal: AbortSignal;
  onEvent: (event: ProviderRunEvent) => void;
}

export interface ProviderInvocation { command: string; args: string[]; stdin?: string; }

const execFileAsync = promisify(execFile);
const binaries: Record<ProviderId, string[]> = {
  codex: ['codex'], claude: ['claude'], cursor: ['cursor-agent', 'agent'], opencode: ['opencode'], copilot: ['copilot'],
};

/** Build argv separately from spawn so process invocation is testable and never uses a shell. */
export function normalizeModelId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('Invalid model ID');
  const model = value.trim();
  if (!model) return undefined;
  if (model.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:/+@-]*(?:\[[A-Za-z0-9]+\])?$/.test(model)) throw new Error('Invalid model ID');
  return model;
}

export function buildProviderInvocation(provider: ProviderId, cwd: string, prompt: string, sessionId?: string, mode: 'read' | 'edit' = 'read', model?: string, effort?: string): ProviderInvocation {
  const modelId = normalizeModelId(model);
  const modelArgs = modelId ? ['--model', modelId] : [];
  if (effort && !/^[a-z][a-z0-9_-]{0,39}$/.test(effort)) throw new Error('Invalid effort');
  if (effort && provider === 'cursor') throw new Error('This CLI does not expose effort selection');
  const effortArgs = !effort ? [] : provider === 'codex' ? ['-c', `model_reasoning_effort="${effort}"`] : provider === 'opencode' ? ['--variant', effort] : ['--effort', effort];
  switch (provider) {
    case 'copilot':
      throw new Error('Copilot requires the interactive ACP transport');
    case 'codex':
      return sessionId
        ? { command: 'codex', args: ['exec', 'resume', '--json', '--skip-git-repo-check', ...modelArgs, ...effortArgs, '-c', `sandbox_mode="${mode === 'edit' ? 'workspace-write' : 'read-only'}"`, '-c', 'approval_policy="never"', sessionId, '-'], stdin: prompt }
        : { command: 'codex', args: ['exec', '--json', '--skip-git-repo-check', ...modelArgs, ...effortArgs, '-c', `sandbox_mode="${mode === 'edit' ? 'workspace-write' : 'read-only'}"`, '-c', 'approval_policy="never"'], stdin: prompt };
    case 'claude':
      return { command: 'claude', args: ['--print', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--forward-subagent-text', '--thinking-display', 'summarized', ...modelArgs, ...effortArgs, '--permission-mode', mode === 'edit' ? 'acceptEdits' : 'plan', ...(sessionId ? ['--resume', sessionId] : [])], stdin: prompt };
    case 'cursor':
      return { command: 'cursor-agent', args: ['--print', '--output-format', 'stream-json', ...modelArgs, ...effortArgs, ...(sessionId ? ['--resume', sessionId] : []), '--', prompt] };
    case 'opencode':
      return { command: 'opencode', args: ['run', '--format', 'json', '--thinking', '--dir', cwd, ...modelArgs, ...effortArgs, ...(sessionId ? ['--session', sessionId] : []), '--', prompt] };
  }
}

type Parsed = ProviderRunEvent[];
const str = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined;
const authPattern = /(?:not logged in|please log in|authentication required|unauthori[sz]ed|invalid (?:api )?key|missing (?:api )?key|no credentials|api key.*(?:missing|invalid)|credential.*(?:missing|invalid)|run .{0,24}(?:login|auth))/i;

function isAuthMessage(value: string): boolean { return authPattern.test(value); }
function event(kind: ProviderRunEvent['kind'], text: string, sessionId?: string): ProviderRunEvent {
  return { kind, text, ...(sessionId ? { sessionId } : {}) };
}

/** Convert one newline-delimited provider record to app-level events. Unknown records remain visible as status. */
export function parseProviderOutputLine(provider: ProviderId, line: string): Parsed {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let value: any;
  try { value = JSON.parse(trimmed); }
  catch { return [event(isAuthMessage(trimmed) ? 'error' : 'text', trimmed)]; }
  if (typeof value === 'string') return [event(isAuthMessage(value) ? 'error' : 'text', value)];
  if (!value || typeof value !== 'object') return [];

  if (provider === 'claude' && value.parent_tool_use_id) return [];
  const sessionId = str(value.session_id) ?? str(value.sessionId) ?? str(value.sessionID) ?? str(value.thread_id);
  const result: ProviderRunEvent[] = [];
  const pushText = (v: unknown) => { const text = str(v); if (text) result.push(event('text', text, sessionId)); };
  const pushTool = (v: unknown) => { const text = str(v); if (text) result.push(event('tool', text, sessionId)); };

  if (provider === 'codex') {
    if (value.type === 'thread.started' && sessionId) result.push(event('status', 'Session started', sessionId));
    else if (value.type === 'item.started' || value.type === 'item.completed') {
      const item = value.item ?? {};
      if (value.type === 'item.completed' && item.type === 'agent_message') pushText(item.text);
      else if (value.type === 'item.started' && item.type === 'command_execution') pushTool(item.command ?? 'Command');
      else if (value.type === 'item.completed' && item.type === 'file_change') pushTool('File changes');
      else if (item.type && item.type !== 'agent_message') result.push(event('status', String(item.type), sessionId));
    } else if (value.type === 'turn.failed' || value.type === 'error') {
      result.push(event('error', str(value.message) ?? str(value.error?.message) ?? 'Provider reported an error', sessionId));
    } else if (value.type === 'turn.completed') result.push(event('status', 'Turn completed', sessionId));
    else if (sessionId) result.push(event('status', String(value.type ?? 'Provider event'), sessionId));
  } else if (provider === 'claude') {
    if (value.type === 'system' && value.subtype === 'init') result.push(event('status', 'Session started', sessionId));
    else if (value.type === 'stream_event') {
      const streamEvent = value.event ?? {};
      if (streamEvent.type === 'content_block_delta' && streamEvent.delta?.type === 'text_delta') pushText(streamEvent.delta.text);
    }
    else if (value.type === 'assistant') {
      for (const block of Array.isArray(value.message?.content) ? value.message.content : []) {
        if (block.type === 'text') pushText(block.text);
        else if (block.type === 'tool_use') pushTool(block.name ?? 'Tool');
      }
    } else if (value.type === 'result') {
      // Claude's result record repeats assistant text already emitted above.
      if (value.is_error) result.push(event('error', str(value.result) ?? 'Provider reported an error', sessionId));
      else result.push(event('status', 'Turn completed', sessionId));
    } else if (value.type === 'user') {
      for (const block of Array.isArray(value.message?.content) ? value.message.content : []) if (block?.type === 'tool_result') pushTool(block.content ?? 'Tool result');
    } else if (value.type === 'error') result.push(event('error', str(value.error?.message) ?? str(value.message) ?? 'Provider reported an error', sessionId));
  } else if (provider === 'cursor') {
    const type = String(value.type ?? value.event ?? '');
    const content = value.text ?? value.message?.content;
    const isUserMessage = value.role === 'user' || value.message?.role === 'user' || type === 'user';
    if (isUserMessage) return [];
    const isAssistantMessage = !isUserMessage && (type === 'assistant' || type === 'assistant_message' || type === 'text' || type === 'message');
    if (isAssistantMessage && typeof content === 'string') pushText(content);
    else if (isAssistantMessage && Array.isArray(content)) for (const block of content) {
      if (block?.type === 'text') pushText(block.text);
      else if (block?.type === 'tool_use' || block?.type === 'tool-call') pushTool(block.name ?? block.toolName ?? 'Tool');
    }
    if (/tool/i.test(type)) pushTool(value.name ?? value.tool ?? 'Tool');
    else if (/error/i.test(type) || value.error || value.is_error === true) result.push(event('error', str(value.error?.message) ?? str(value.message) ?? str(value.result) ?? 'Provider reported an error', sessionId));
    else if (type && !result.length) result.push(event('status', type, sessionId));
  } else {
    const type = String(value.type ?? '');
    if (type === 'text' || type === 'text_delta') pushText(value.part?.text ?? value.text);
    else if (type === 'tool_use' || type === 'tool') pushTool(value.part?.state?.input?.command ?? value.tool?.name ?? value.name ?? 'Tool');
    else if (type === 'step_finish' || type === 'session.updated') result.push(event('status', type, sessionId));
    else if (type === 'error' || value.error) result.push(event('error', str(value.error?.message) ?? str(value.message) ?? 'Provider reported an error', sessionId));
    else if (type) result.push(event('status', type, sessionId));
  }
  // API/credential failures can arrive in otherwise provider-specific JSON records.
  const failureRecord = value.type === 'error' || value.is_error === true || Boolean(value.error);
  for (const candidate of failureRecord ? [str(value.message), str(value.error?.message), str(value.result)] : []) {
    if (candidate && isAuthMessage(candidate) && !result.some(x => x.kind === 'error')) result.push(event('error', candidate, sessionId));
  }
  return result;
}

function providerEnvironment(): NodeJS.ProcessEnv {
  const home = homedir();
  const knownDirs = process.platform === 'win32'
    ? [process.env.APPDATA && join(process.env.APPDATA, 'npm'), process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'), join(home, '.bun', 'bin'), join(home, '.local', 'bin'), join(home, '.cursor', 'bin')]
    : [join(home, '.local', 'bin'), join(home, '.opencode', 'bin'), join(home, '.npm-global', 'bin'), join(home, '.bun', 'bin'), join(home, 'Library', 'pnpm'), join(home, 'Library', 'Application Support', 'Cursor', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  const dirs = [...(process.env.PATH ?? '').split(delimiter), ...knownDirs.filter((dir): dir is string => Boolean(dir))].filter(Boolean);
  return { ...process.env, PATH: [...new Set(dirs)].join(delimiter) };
}

function captureCliOutput(command: string, args: string[], timeout: number): { stdout: string; stderr: string } {
  const result = crossSpawn.sync(command, args, { encoding: 'utf8', timeout, windowsHide: true, env: providerEnvironment() });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || `CLI exited with code ${result.status}`).trim());
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

async function findExecutable(provider: ProviderId): Promise<string | undefined> {
  const env = providerEnvironment();
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  const windowsExts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const name of binaries[provider]) {
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execFileAsync('where.exe', [name], { timeout: 1500, windowsHide: true, env });
        const found = stdout.split(/\r?\n/).map(value => value.trim()).find(Boolean);
        if (found && (provider !== 'cursor' || name === 'cursor-agent' || isCursorAgentAlias(found))) return found;
      } catch { /* continue with known executable directories */ }
    }
    for (const dir of dirs) {
      const candidates = name.includes('.') ? [join(dir, name)] : windowsExts.map(extension => join(dir, `${name}${extension}`));
      for (const candidate of candidates) {
        try {
          await new Promise<void>((resolve, reject) => access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK, error => error ? reject(error) : resolve()));
          if (provider !== 'cursor' || name === 'cursor-agent' || isCursorAgentAlias(candidate)) return candidate;
        } catch { /* continue */ }
      }
    }
  }
  return undefined;
}

function isCursorAgentAlias(path: string): boolean {
  try { return /cursor/i.test(`${captureCliOutput(path, ['--version'], 1500).stdout}\n${captureCliOutput(path, ['--help'], 1500).stdout}`); }
  catch { return false; }
}

export async function discoverProviders(): Promise<ProviderInfo[]> {
  return Promise.all((Object.keys(binaries) as ProviderId[]).map(async id => {
    const path = await findExecutable(id);
    if (!path) return { id, name: displayName(id), available: false };
    try {
      const { stdout, stderr } = captureCliOutput(path, ['--version'], 2500);
      const version = `${stdout}${stderr}`.trim().split(/\r?\n/)[0]?.slice(0, 160);
      return { id, name: displayName(id), available: true, path, ...(version ? { version } : {}) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { id, name: displayName(id), available: true, path, error: message.slice(0, 240) };
    }
  }));
}

export function parseListedModels(output: string, provider: 'cursor' | 'opencode'): ModelOption[] {
  const candidates: { id: string; label: string }[] = [];
  try {
    const parsed = JSON.parse(output);
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.models) ? parsed.models : [];
    for (const row of rows) {
      const id = typeof row === 'string' ? row : row?.id ?? row?.slug ?? row?.name;
      if (typeof id === 'string') candidates.push({ id, label: typeof row?.display_name === 'string' ? row.display_name : id });
    }
  } catch {
    let cursorHeader = false;
    for (const line of output.split(/\r?\n/)) {
      const clean = line.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1F\x7F]/g, '').trim();
      if (provider === 'cursor') {
        if (/^Available models\s*:?$/i.test(clean)) { cursorHeader = true; continue; }
        if (!cursorHeader) continue;
        const match = clean.match(/^([A-Za-z0-9][A-Za-z0-9._:/+@-]*)\s+-\s+(.{1,100})$/);
        if (match) candidates.push({ id: match[1], label: match[2] });
      } else if (/^[A-Za-z0-9][A-Za-z0-9._:/+@-]*\/[A-Za-z0-9._:/+@-]+$/.test(clean)) {
        candidates.push({ id: clean, label: clean });
      }
    }
  }
  const unique = new Set<string>();
  const options: ModelOption[] = [];
  for (const candidate of candidates) {
    try {
      const id = normalizeModelId(candidate.id);
      if (!id) continue;
      if (provider === 'opencode' && !id.includes('/')) continue;
      if (unique.has(id)) continue;
      unique.add(id);
      options.push({ id, label: candidate.label.replace(/[\x00-\x1F\x7F]/g, ' ').slice(0, 100), source: 'discovered' });
    } catch { /* ignore non-model output */ }
    if (unique.size >= 300) break;
  }
  return options;
}

async function captureModelList(executable: string, args: string[], timeoutMs: number, stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = crossSpawn(executable, args, { env: providerEnvironment(), windowsHide: true, detached: process.platform !== 'win32', stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let output = '', stderr = '', settled = false;
    const decoder = new StringDecoder('utf8');
    child.stdin?.on('error', () => {});
    if (stdin !== undefined) child.stdin?.end(stdin);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(output);
    };
    const timer = setTimeout(() => {
      killProcessTree(child);
      setTimeout(() => {
        if (child.pid) try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
      }, 500).unref();
      finish(new Error('Model listing timed out'));
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      output += decoder.write(chunk);
      if (output.length > 2_000_000) { killProcessTree(child); finish(new Error('Model listing was too large')); }
    });
    child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-2000); });
    child.once('error', error => finish(error));
    child.once('close', code => finish(code === 0 ? undefined : new Error(stderr || `Model listing exited with code ${code}`)));
  });
}

export async function discoverModels(provider: ProviderId): Promise<ModelCatalogue> {
  if (provider === 'copilot') {
    const executable = await findExecutable(provider);
    if (!executable) return { provider, options: [], warning: 'Copilot CLI not found. Install copilot and sign in with copilot login.' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const rpc = new ProviderRpc(executable, ['--acp', '--stdio'], homedir(), providerEnvironment(), controller.signal);
    try {
      await rpc.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'vulp', version: '0.5.0' } });
      const session = await rpc.request('session/new', { cwd: homedir(), mcpServers: [] });
      const options = parseCopilotModels(session);
      return { provider, options, warning: options.length ? undefined : 'Copilot did not advertise models. Use CLI default or enter a model ID. Sign in with copilot login if needed.' };
    } catch {
      return { provider, options: [], warning: 'Could not query Copilot ACP. Update copilot and sign in with copilot login, then refresh discovery.' };
    } finally { clearTimeout(timer); rpc.close(); }
  }
  if (provider === 'codex') {
    try {
      const file = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'models_cache.json');
      if ((await fs.stat(file)).size > 2_000_000) throw new Error('Cache is too large');
      const cache = JSON.parse(await fs.readFile(file, 'utf8')) as { models?: unknown };
      const rows = Array.isArray(cache.models) ? cache.models : [];
      const options = rows.filter((row: any) => row?.visibility === 'list')
        .sort((a: any, b: any) => {
          const left = Number(a.priority), right = Number(b.priority);
          return (Number.isFinite(left) ? left : 999) - (Number.isFinite(right) ? right : 999);
        })
        .flatMap((row: any): ModelOption[] => {
          try {
            const id = normalizeModelId(row.slug);
            if (!id) return [];
            const label = typeof row.display_name === 'string' ? row.display_name.replace(/[\r\n]/g, ' ').slice(0, 100) : id;
            const efforts = Array.isArray(row.supported_reasoning_levels) ? row.supported_reasoning_levels.map((level: any) => level.effort).filter((level: unknown): level is string => typeof level === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(level)) : [];
            const contextWindows = [...new Set([row.context_window, row.max_context_window].filter(value => Number.isSafeInteger(value) && value > 0))] as number[];
            return [{ id, label, source: 'discovered', ...(efforts.length ? { efforts } : {}), ...(contextWindows.length > 1 ? { contextWindows } : {}), ...(row.service_tiers?.some((tier: any) => tier.id === 'priority') ? { supportsFastMode: true } : {}) }];
          } catch { return []; }
        });
      return { provider, options };
    } catch { return { provider, options: [], warning: 'Local Codex model cache unavailable. Enter a model ID manually.' }; }
  }
  if (provider === 'claude') {
    const executable = await findExecutable(provider);
    if (executable) try {
      const request = JSON.stringify({ type: 'control_request', request_id: 'j2code-model-capabilities', request: { subtype: 'initialize' } }) + '\n';
      const output = await captureModelList(executable, ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], 5000, request);
      const options = parseClaudeModels(output);
      if (options.length) return { provider, options, warning: 'Capabilities reported by the local Claude CLI. Account and organization restrictions are enforced by the CLI.' };
    } catch { /* Older or unavailable CLIs fall back to aliases without guessed effort levels. */ }
    return { provider, options: [
      { id: 'fable', label: 'Fable (CLI alias)', source: 'alias' },
      { id: 'opus', label: 'Opus (CLI alias)', source: 'alias' },
      { id: 'sonnet', label: 'Sonnet (CLI alias)', source: 'alias' }
    ], warning: 'Model capabilities unavailable; aliases only. Account availability is checked by the CLI. Effort uses its default.' };
  }
  const executable = await findExecutable(provider);
  if (!executable) return { provider, options: [], warning: 'CLI not found. Enter a model ID manually after installing it.' };
  try {
    const output = await captureModelList(executable, provider === 'opencode' ? ['models', '--verbose'] : ['models'], 4000);
    if (authPattern.test(output)) throw new Error('Sign-in required');
    const verbose = provider === 'opencode' ? parseOpenCodeModels(output) : [];
    const options = verbose.length ? verbose : parseListedModels(output, provider);
    return { provider, options, warning: options.length ? 'Models listed by the local CLI; account availability is checked when you run.' : 'The CLI returned no models. Enter a model ID manually.' };
  } catch {
    return { provider, options: [], warning: 'Could not list models from this CLI. Enter a model ID manually.' };
  }
}

function displayName(id: ProviderId): string {
  return ({ codex: 'Codex', claude: 'Claude Code', cursor: 'Cursor', opencode: 'OpenCode', copilot: 'GitHub Copilot' })[id];
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch { /* process already exited */ }
  }
}

export async function runProvider(input: RunProviderArgs): Promise<{ sessionId?: string }> {
  if (input.signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
  const startedAt = Date.now();
  let codexActivity: ReturnType<typeof watchCodexActivity> | undefined;
  if (input.tools || input.readOnlyChild || input.provider === 'copilot' || input.onApproval || (input.mode && !['read','edit'].includes(input.mode))) {
    const executable = await findExecutable(input.provider);
    if (!executable) throw new Error(`${displayName(input.provider)} CLI not found`);
    return runInteractiveProvider(input, executable, providerEnvironment());
  }
  const mode = input.mode === 'edit' ? 'edit' : 'read';
  const invocation = buildAttachmentInvocation(input.provider, input.cwd, input.prompt, input.sessionId, mode, input.model, input.effort, input.attachments || []);
  const executable = await findExecutable(input.provider);
  if (input.signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
  if (!executable) throw new Error(`${displayName(input.provider)} CLI not found. Install ${binaries[input.provider][0]} and ensure it is on PATH.`);
  const child = crossSpawn(executable, invocation.args, {
    cwd: input.cwd,
    env: providerEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  let sessionId = input.sessionId;
  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let stderrTail = '';
  let authFailure: string | undefined;
  let providerFailure: string | undefined;
  const claudeText = createClaudeTextStream();
  let hasCodexText = false;
  const activityParser = createActivityParser(input.provider);
  const emitLine = (line: string) => {
    for (const activity of activityParser(line)) input.onEvent({ kind: 'activity', text: activity.title, activity });
    const events = parseProviderOutputLine(input.provider, line);
    if (input.provider === 'claude') {
      try {
        const record = JSON.parse(line);
        const text = claudeText(record);
        if (record.type === 'assistant' || record.type === 'stream_event') {
          const sessionId = events.find(e => e.sessionId)?.sessionId;
          // Replace only response text; keep status, tools, and activity events.
          for (let i = events.length - 1; i >= 0; i--) if (events[i].kind === 'text') events.splice(i, 1);
          if (text) events.push(event('text', text, sessionId));
        }
      } catch { /* Plain CLI diagnostics are handled by the line parser. */ }
    }
    for (const e of events) {
      if (e.sessionId) {
        sessionId = e.sessionId;
        if (input.provider === 'codex' && !codexActivity) codexActivity = watchCodexActivity(e.sessionId, startedAt, activity => input.onEvent({ kind: 'activity', text: activity.title, activity }));
      }
      if (e.kind === 'error') authFailure = e.text;
      if (input.provider === 'codex' && e.kind === 'text') {
        // Codex exec emits complete message items rather than token deltas.
        if (hasCodexText) e.text = '\n\n' + e.text;
        hasCodexText = true;
      }
      input.onEvent(e);
    }
  };
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let terminating = false;
  let terminationComplete: Promise<void> | undefined;
  const terminateTree = () => {
    if (terminating) return;
    terminating = true;
    killProcessTree(child);
    terminationComplete = new Promise(resolve => {
      killTimer = setTimeout(() => {
        if (child.pid) {
          try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); }
          catch { try { child.kill('SIGKILL'); } catch { /* already exited */ } }
        }
        resolve();
      }, 1500);
    });
  };
  const maxLineLength = 1024 * 1024;
  const consume = (buffer: string, chunk: Buffer, decoder: StringDecoder, sink: (line: string) => void): string => {
    const combined = buffer + decoder.write(chunk);
    const lines = combined.split(/\r?\n/);
    for (const line of lines.slice(0, -1)) {
      if (line.length > maxLineLength) {
        providerFailure = 'Provider output line exceeded 1 MiB';
        input.onEvent(event('error', providerFailure, sessionId));
        terminateTree();
        return '';
      }
      sink(line);
    }
    const tail = lines[lines.length - 1] ?? '';
    if (tail.length > maxLineLength) {
      providerFailure = 'Provider output line exceeded 1 MiB';
      input.onEvent(event('error', providerFailure, sessionId));
      terminateTree();
      return '';
    }
    return tail;
  };
  const onAbort = terminateTree;
  input.signal.addEventListener('abort', onAbort, { once: true });
  child.stdin?.on('error', error => {
    if ((error as NodeJS.ErrnoException).code === 'EPIPE') return;
    providerFailure = error.message;
    input.onEvent(event('error', error.message, sessionId));
  });
  child.stdin?.end(invocation.stdin);
  child.stdout?.on('data', chunk => { stdoutBuffer = consume(stdoutBuffer, chunk, stdoutDecoder, emitLine); });
  child.stderr?.on('data', chunk => {
    stderrBuffer = consume(stderrBuffer, chunk, stderrDecoder, line => {
      if (!line.trim()) return;
      stderrTail = `${stderrTail}\n${line}`.slice(-3000);
      if (isAuthMessage(line)) authFailure = line;
      input.onEvent(event(isAuthMessage(line) ? 'error' : 'status', line));
    });
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => { input.signal.removeEventListener('abort', onAbort); if (killTimer) clearTimeout(killTimer); };
    child.once('error', error => { if (!settled) { settled = true; cleanup(); reject(error); } });
    child.once('close', async (code, signal) => {
      stdoutBuffer += stdoutDecoder.end();
      stderrBuffer += stderrDecoder.end();
      if (stdoutBuffer.trim()) emitLine(stdoutBuffer);
      if (stderrBuffer.trim()) {
        stderrTail = `${stderrTail}\n${stderrBuffer}`.slice(-3000);
        if (isAuthMessage(stderrBuffer)) authFailure = stderrBuffer;
        input.onEvent(event(isAuthMessage(stderrBuffer) ? 'error' : 'status', stderrBuffer));
      }
      if (terminationComplete) await terminationComplete;
      if (codexActivity) await codexActivity.stop().catch(() => {});
      cleanup();
      if (settled) return;
      settled = true;
      if (input.signal.aborted) reject(new DOMException('The operation was aborted', 'AbortError'));
      else if (providerFailure) reject(new Error(providerFailure));
      else if (authFailure) reject(new Error(authFailure));
      else if (code === 0) resolve(sessionId ? { sessionId } : {});
      else {
        const message = stderrTail.trim() || `Provider exited with ${signal ? `signal ${signal}` : `code ${code}`}`;
        input.onEvent(event(isAuthMessage(message) ? 'error' : 'error', message, sessionId));
        reject(new Error(message));
      }
    });
  });
}

export function parseOpenCodeModels(output: string): ModelOption[] {
  const options: ModelOption[] = [];
  for (const match of output.matchAll(/^(\S+\/\S+)\r?\n(\{[\s\S]*?^\})/gm)) {
    try {
      const row = JSON.parse(match[2]);
      const id = normalizeModelId(match[1]);
      if (!id) continue;
      const efforts = Object.entries(row.variants || {}).filter(([key, value]: [string, any]) => /^[a-z][a-z0-9_-]{0,39}$/.test(key) && !value?.disabled).map(([key]) => key);
      options.push({ id, label: typeof row.name === 'string' ? row.name.slice(0,100) : id, source: 'discovered', ...(efforts.length ? { efforts } : {}) });
    } catch { /* Ignore malformed local metadata. */ }
  }
  return options;
}

export async function validateEffort(provider: ProviderId, model: string | undefined, value: unknown): Promise<string | undefined> {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !model) throw new Error('Choose a model with advertised effort levels first');
  const catalogue = await discoverModels(provider);
  if (!catalogue.options.find(option => option.id === model)?.efforts?.includes(value)) throw new Error('This effort is not advertised for the selected model');
  return value;
}

export function parseClaudeModels(output: string): ModelOption[] {
  for (const line of output.split('\n')) try {
    const frame = JSON.parse(line);
    if (frame.type !== 'control_response' || frame.response?.subtype !== 'success' || frame.response?.request_id !== 'j2code-model-capabilities') continue;
    const models = frame.response?.response?.models;
    if (!Array.isArray(models)) continue;
    return models.slice(0,300).flatMap((row: any): ModelOption[] => {
      try {
        const id = normalizeModelId(row.value);
        if (!id) return [];
        const efforts = row.supportsEffort && Array.isArray(row.supportedEffortLevels) ? row.supportedEffortLevels.filter((value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(value)) : [];
        return [{ id, label: typeof row.displayName === 'string' ? row.displayName.replace(/[\r\n]/g,' ').slice(0,100) : id, source: 'discovered', ...(efforts.length ? { efforts } : {}), ...(row.supportsFastMode === true ? { supportsFastMode: true } : {}) }];
      } catch { return []; }
    });
  } catch { /* Not a capabilities frame. */ }
  return [];
}


export function buildAttachmentInvocation(provider: ProviderId, cwd: string, prompt: string, sessionId: string | undefined, mode: 'read' | 'edit', model: string | undefined, effort: string | undefined, files: ResolvedAttachment[]): ProviderInvocation {
  const {text,images} = prepareAttachments(provider,prompt,files);
  const result = buildProviderInvocation(provider,cwd,text,sessionId,mode,model,effort);
  if (provider === 'codex' && images.length) result.args.splice(sessionId ? 2 : 1,0,...images.flatMap(file => ['--image',file.path]));
  if (provider === 'opencode' && files.length) result.args.splice(1,0,...files.flatMap(file => ['--file',file.path]));
  if (provider === 'claude' && images.length) {
    result.args.push('--input-format','stream-json');
    result.stdin = JSON.stringify({type:'user',session_id:sessionId || '',parent_tool_use_id:null,message:{role:'user',content:[...images.map(file=>({type:'image',source:{type:'base64',media_type:file.mime,data:file.data.toString('base64')}})),{type:'text',text}]}})+'\n';
  }
  return result;
}

export async function validateModelSettings(provider: ProviderId, model: string | undefined, settings: {contextWindow?: unknown; fastMode?: unknown}) {
  const {contextWindow, fastMode} = settings;
  if (contextWindow === undefined && fastMode === undefined) return {};
  const option = (await discoverModels(provider)).options.find(option => option.id === model);
  if (contextWindow !== undefined && (typeof contextWindow !== 'number' || !option?.contextWindows?.includes(contextWindow))) throw new Error('This context length is not advertised for the selected model');
  if (fastMode !== undefined && (typeof fastMode !== 'boolean' || !option?.supportsFastMode)) throw new Error('Fast mode is not advertised for the selected model');
  return {contextWindow: contextWindow as number | undefined, fastMode: fastMode as boolean | undefined};
}

/** Use ACP-advertised models rather than a hard-coded catalogue. */
export function parseCopilotModels(session: any): ModelOption[] {
  const config = session.configOptions?.find((option: any) => option.category === 'model' || option.id === 'model');
  const rows = config?.options?.flatMap((option: any) => option.options || [option])
    || session.models?.availableModels || [];
  const seen = new Set<string>();
  return rows.slice(0, 300).flatMap((row: any): ModelOption[] => {
    try {
      const id = normalizeModelId(row.value ?? row.modelId);
      if (!id || seen.has(id)) return [];
      seen.add(id);
      return [{ id, label: typeof row.name === 'string' ? row.name.replace(/[\r\n]/g, ' ').slice(0, 100) : id, source: 'discovered' }];
    } catch { return []; }
  });
}
