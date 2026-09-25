import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ProviderId, ActivityUpdate } from '../shared/api';
import type { RunProviderArgs } from './providers';

export interface ProviderTool {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  call: (args: Record<string, unknown>) => Promise<unknown>;
}
export type ProviderRunner = (input: RunProviderArgs) => Promise<{ sessionId?: string }>;
type ChildProvider = Extract<ProviderId, 'codex' | 'claude'>;
type ChildStatus = 'running' | 'completed' | 'failed' | 'interrupted';
interface Child {
  id: string;
  provider: ChildProvider;
  model?: string;
  task: string;
  status: ChildStatus;
  result: string;
  error?: string;
  sessionId?: string;
  truncated: boolean;
  activity: Map<string, ActivityUpdate>;
  controller: AbortController;
  done: Promise<void>;
}
const MAX_OUTPUT = 20_000;
const MAX_CHILDREN = 3;
const MAX_RUNS = 12;
const model = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:/+@-]*(?:\[[A-Za-z0-9]+\])?$/).optional();

/** One parent turn owns all child processes, identities, output and tool access. */
export class Delegation {
  readonly tools: ProviderTool[];
  private children = new Map<string, Child>();
  private closed = false;
  private abort = () => { for (const child of this.children.values()) this.stop(child); };

  constructor(private parent: RunProviderArgs, private enabled: readonly ProviderId[], private run: ProviderRunner) {
    parent.signal.addEventListener('abort', this.abort, { once: true });
    this.tools = [
      { name: 'vulp_spawn_agent', description: 'Start a read-only review or research agent using another provider. Available providers: ' + enabled.filter(p => p === 'codex' || p === 'claude').join(', ') + '. Give a self-contained task including file paths and context; children do not inherit this conversation. Returns immediately. Collect its result with vulp_wait_agent before answering. At most 3 children at once and 12 per turn; children cannot delegate.', schema: { provider: z.enum(['codex', 'claude']), model, task: z.string().trim().min(1).max(20_000) }, call: async args => this.spawn(args as { provider: ChildProvider; model?: string; task: string }) },
      { name: 'vulp_wait_agent', description: 'Wait up to timeoutMs (default 10000, maximum 30000) for a child from this turn. Returns running or its final result/error. Call again if running. Results remain available for this turn.', schema: { agentId: z.string().min(1), timeoutMs: z.number().int().min(0).max(30_000).optional() }, call: async args => this.wait(String(args.agentId), args.timeoutMs as number | undefined) },
      { name: 'vulp_cancel_agent', description: 'Cancel a child from this turn. Completed children keep their result.', schema: { agentId: z.string().min(1) }, call: async args => { const child = this.get(String(args.agentId)); this.stop(child); await child.done; return this.result(child); } },
    ];
  }
  private get(id: string) {
    const child = this.children.get(id);
    if (!child) throw new Error('Unknown agent for this parent turn');
    return child;
  }
  private result(child: Child) {
    return { agentId: child.id, provider: child.provider, model: child.model, status: child.status, result: child.result, truncated: child.truncated, error: child.error };
  }
  private emit(child: Child) {
    this.parent.onEvent({ kind: 'activity', text: child.task, activity: {
      id: child.id, agentId: child.id, kind: 'agent', title: `${child.provider === 'codex' ? 'Codex' : 'Claude'}${child.model ? ` · ${child.model}` : ''} · ${child.task.slice(0, 100)}`,
      detail: [child.task, child.result, child.error].filter(Boolean).join('\n\n'), status: child.status,
      provider: child.provider, model: child.model, sessionId: child.sessionId,
    } });
  }
  private stop(child: Child) {
    if (child.status !== 'running') return;
    child.status = 'interrupted';
    child.controller.abort();
    this.emit(child);
  }
  private spawn(args: { provider: ChildProvider; model?: string; task: string }) {
    if (this.closed || this.parent.signal.aborted) throw new Error('Parent turn has ended');
    if (!this.enabled.includes(args.provider)) throw new Error('Provider is disabled or unavailable');
    if (this.children.size >= MAX_RUNS) throw new Error('Maximum 12 child runs per turn');
    if ([...this.children.values()].filter(c => c.status === 'running').length >= MAX_CHILDREN) throw new Error('Maximum 3 concurrent children; wait for one to finish');
    const child: Child = { ...args, id: `agent:${randomUUID()}`, status: 'running', result: '', truncated:false, activity:new Map(), controller: new AbortController(), done: Promise.resolve() };
    this.children.set(child.id, child);
    this.emit(child);
    child.done = this.execute(child);
    return this.result(child);
  }
  private async execute(child: Child) {
    const timer = setTimeout(() => { child.error = 'Child exceeded the 10 minute limit'; this.stop(child); }, 10 * 60_000);
    try {
      const result = await this.run({ provider: child.provider, model: child.model, cwd: this.parent.cwd,
        prompt: `You are a read-only review/research child agent. Do not edit files, perform external mutations, or delegate. Return concise findings with file paths and evidence. You have only this task brief, not the parent conversation.\n\n${child.task}`,
        mode: 'supervised', readOnlyChild: true, signal: child.controller.signal, onApproval: async () => false,
        onEvent: event => {
          if (child.controller.signal.aborted) return;
          if (event.sessionId) child.sessionId = event.sessionId;
          if (event.kind === 'text') {
            child.truncated ||= child.result.length + event.text.length > MAX_OUTPUT;
            child.result = (child.result + event.text).slice(-MAX_OUTPUT);
          }
          if (event.kind === 'error') child.error = event.text.slice(-MAX_OUTPUT);
          if (event.kind === 'activity' && event.activity) {
            const a = event.activity;
            const activity: ActivityUpdate = { ...a, id: `${child.id}:${a.id}`, parentId: a.parentId ? `${child.id}:${a.parentId}` : child.id };
            if(activity.status === 'running') child.activity.set(activity.id,activity); else child.activity.delete(activity.id);
            this.parent.onEvent({ kind: 'activity', text: activity.title, activity });
          } else this.emit(child);
        },
      });
      child.sessionId = result.sessionId || child.sessionId;
      if (!child.controller.signal.aborted) {
        if (!child.result.trim() && !child.error) child.error = 'Provider completed without a text response';
        child.status = child.error ? 'failed' : 'completed';
      }
    } catch (error) {
      if (!child.controller.signal.aborted) { child.status = 'failed'; child.error = error instanceof Error ? error.message : String(error); }
    } finally {
      clearTimeout(timer);
      for(const activity of child.activity.values()) this.parent.onEvent({kind:'activity',text:activity.title,activity:{...activity,detail:'',append:true,status:child.status === 'interrupted' ? 'interrupted' : child.status === 'failed' ? 'failed' : 'unknown'}});
      child.activity.clear();
      this.emit(child);
    }
  }
  private async wait(id: string, timeoutMs = 10_000) {
    const child = this.get(id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([child.done, new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })]); }
    finally { clearTimeout(timer); }
    return this.result(child);
  }
  async close() {
    this.closed = true;
    this.parent.signal.removeEventListener('abort', this.abort);
    this.abort();
    await Promise.all([...this.children.values()].map(c => c.done));
  }
}

/** Shared validation/error semantics for both provider transports. */
export async function callProviderTool(tools: readonly ProviderTool[], name: string, args: unknown) {
  try {
    const tool = tools.find(tool => tool.name === name);
    if (!tool) throw new Error(`Unknown Conduit tool: ${name}`);
    const parsed = z.object(tool.schema).strict().parse(args);
    return { success: true, text: JSON.stringify(await tool.call(parsed)) };
  } catch (error) { return { success: false, text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }; }
}

export async function runWithDelegation(input: RunProviderArgs, enabled: readonly ProviderId[], run: ProviderRunner) {
  if (input.readOnlyChild || !['codex', 'claude'].includes(input.provider)) return run(input);
  const delegation = new Delegation(input, enabled, run);
  try { return await run({ ...input, tools: delegation.tools }); }
  finally { await delegation.close(); }
}
