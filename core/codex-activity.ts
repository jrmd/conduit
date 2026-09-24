import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import type { ActivityUpdate } from '../shared/api';

const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
interface Tail { id: string; parentId?: string; file?: string; offset: number; pending: string; decoder: StringDecoder; skipFirst?: boolean; }

/** Some Codex CLI builds omit SubAgentActivity from exec JSON. Read only that run's
 * public item events and its explicitly linked child sessions. Never decode raw reasoning. */
export function watchCodexActivity(rootId: string, since: number, emit: (event: ActivityUpdate) => void, home = process.env.CODEX_HOME || join(homedir(), '.codex')) {
  const tails = new Map<string, Tail>();
  if (uuid.test(rootId)) tails.set(rootId, { id: rootId, offset: 0, pending: '', decoder: new StringDecoder('utf8') });
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let work: Promise<void> = Promise.resolve();
  const files = new Map<string, string>();
  let lastSearch = 0;
  async function locate() {
    if (Date.now() - lastSearch < 1000) return;
    lastSearch = Date.now();
    const needed = [...tails.values()].filter(tail => !tail.file);
    if (!needed.length) return;
    let visited = 0;
    async function scan(directory: string, depth: number): Promise<void> {
      if (depth > 4 || visited > 10000) return;
      let entries; try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (++visited > 10000) return;
        if (entry.isDirectory()) await scan(join(directory, entry.name), depth + 1);
        else if (entry.isFile()) for (const tail of needed) if (entry.name.endsWith(`-${tail.id}.jsonl`)) files.set(tail.id, join(directory, entry.name));
      }
    }
    // New sessions live in today's folder. Fall back to the filename index for resumes.
    const day = new Date().toISOString().slice(0,10).replaceAll('-', '/');
    await scan(join(home, 'sessions', day), 3);
    if (needed.some(tail => !files.has(tail.id))) await scan(join(home, 'sessions'), 0);
    for (const tail of needed) tail.file = files.get(tail.id);
  }
  function parse(tail: Tail, line: string) {
    let record: any; try { record = JSON.parse(line); } catch { return; }
    if (record.type !== 'event_msg' || !Number.isFinite(Date.parse(record.timestamp)) || Date.parse(record.timestamp) < since) return;
    const payload = record.payload;
    if (payload?.type !== 'item_completed') return;
    const item = payload.item || {};
    const parentId = tail.id === rootId ? undefined : `agent:${tail.id}`;
    if (item.type === 'SubAgentActivity' && uuid.test(item.agent_thread_id)) {
      const child = item.agent_thread_id;
      const state = item.kind === 'completed' ? 'completed' : /failed|error/.test(item.kind) ? 'failed' : /interrupt|cancel/.test(item.kind) ? 'interrupted' : 'running';
      emit({ id: `agent:${child}`, kind: 'agent', title: item.agent_path || `Agent ${child.slice(0,8)}`, detail: '', append: true, status: state, agentId: child, parentId });
      if (!tails.has(child) && tails.size < 64) tails.set(child, { id: child, parentId, offset: 0, pending: '', decoder: new StringDecoder('utf8') });
      return;
    }
    if (!parentId) return;
    const id = `child:${tail.id}:${item.id}`;
    const state = /fail|error/.test(item.status || '') ? 'failed' : 'completed';
    if (item.type === 'AgentMessage') {
      const detail = (item.content || []).filter((part: any) => part.type === 'Text').map((part: any) => part.text).join('\n');
      emit({ id, kind: 'status', title: item.phase === 'final_answer' ? 'Agent response' : 'Agent update', detail, status: 'completed', parentId });
    } else if (item.type === 'CommandExecution') emit({ id, kind: 'tool', title: item.command || 'Command', detail: item.aggregated_output || item.stdout || '', status: state, parentId });
    else if (item.type === 'Reasoning' && Array.isArray(item.summary)) emit({ id, kind: 'reasoning', title: 'Thinking summary', detail: item.summary.filter((part: unknown) => typeof part === 'string').join('\n'), status: 'completed', parentId });
  }
  async function poll() {
    await locate();
    for (const tail of [...tails.values()]) {
      if (!tail.file) continue;
      try {
        const file = await fs.open(tail.file, 'r');
        try {
          const stat = await file.stat();
          if (tail.offset > stat.size) { tail.offset = 0; tail.pending = ''; tail.decoder = new StringDecoder('utf8'); }
          if (tail.offset === 0 && stat.size > 4 * 1024 * 1024) { tail.offset = stat.size - 4 * 1024 * 1024; tail.skipFirst = true; }
          for (let chunk = 0; chunk < 4 && tail.offset < stat.size; chunk++) {
            const buffer = Buffer.alloc(Math.min(1024 * 1024, stat.size - tail.offset));
            const { bytesRead } = await file.read(buffer, 0, buffer.length, tail.offset); if (!bytesRead) break;
            tail.offset += bytesRead;
            const lines = (tail.pending + tail.decoder.write(buffer.subarray(0, bytesRead))).split('\n');
            tail.pending = lines.pop() || '';
            for (const line of lines) { if (tail.skipFirst) { tail.skipFirst = false; continue; } if (line.length < 1024 * 1024) parse(tail, line); }
            if (tail.pending.length > 1024 * 1024) tail.pending = '';
          }
        } finally { await file.close(); }
      } catch { /* Session logs are optional; exec events remain available. */ }
    }
  }
  function tick() { work = poll().catch(() => {}).finally(() => { if (!stopped) timer = setTimeout(tick, 300); }); }
  tick();
  return { async stop() { stopped = true; if (timer) clearTimeout(timer); await work; for (let depth = 0; depth < 5; depth++) { lastSearch = 0; await poll(); if ([...tails.values()].every(tail => tail.file)) break; } } };
}
