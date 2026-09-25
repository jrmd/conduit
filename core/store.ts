import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ActivityUpdate, Message, ThreadUsage, Project, ProviderId, Snapshot, Thread, ThreadConfig, ThreadMode, ThreadWorkspace } from '../shared/api.js';

interface State { projects: Project[]; threads: Thread[]; disabledProviders: ProviderId[]; }

export class Store {
  private state: State = { projects: [], threads: [], disabledProviders: [] };
  private saving = Promise.resolve();
  constructor(private file: string) {}

  async load() {
    try {
      const value = JSON.parse(await fs.readFile(this.file, 'utf8')) as State;
      if (Array.isArray(value.projects) && Array.isArray(value.threads)) this.state = { ...value, disabledProviders: (value.disabledProviders || []).filter(id => ['codex', 'claude', 'cursor', 'opencode', 'copilot'].includes(id)) };
      for (const thread of this.state.threads) for (const item of thread.activity || []) if (item.status === 'running') item.status = 'interrupted';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  snapshot(): Pick<Snapshot, 'projects' | 'threads' | 'disabledProviders'> { return structuredClone(this.state); }
  async setProviderEnabled(id: ProviderId, enabled: boolean) {
    this.state.disabledProviders = this.state.disabledProviders.filter(item => item !== id);
    if (!enabled) this.state.disabledProviders.push(id);
    await this.save();
  }
  getProject(id: string) {
    const project = this.state.projects.find(item => item.id === id);
    if (!project) throw new Error('Project not found');
    return project;
  }
  getThread(id: string) {
    const thread = this.state.threads.find(item => item.id === id);
    if (!thread) throw new Error('Thread not found');
    return thread;
  }
  async addProject(directory: string) {
    const real = await fs.realpath(directory);
    const stat = await fs.stat(real);
    if (!stat.isDirectory()) throw new Error('Project path must be a directory');
    let project = this.state.projects.find(item => item.path === real);
    if (!project) {
      project = { id: randomUUID(), name: path.basename(real), path: real, createdAt: Date.now() };
      this.state.projects.unshift(project);
      await this.save();
    }
    return structuredClone(project);
  }
  async createThread(projectId: string, provider: ProviderId, mode: ThreadMode, model?: string, effort?: string, workspace?: ThreadWorkspace) {
    this.getProject(projectId);
    const now = Date.now();
    const thread: Thread = { id: randomUUID(), projectId, provider, mode, workspace, ...(model ? { model } : {}), ...(effort ? { effort } : {}), title: 'New thread', messages: [], createdAt: now, updatedAt: now };
    this.state.threads.unshift(thread);
    await this.save();
    return structuredClone(thread);
  }
  async configureThread(id: string, config: ThreadConfig) {
    const thread = this.getThread(id);
    if ((thread.messages.some(message => message.role === 'user') || thread.sessionId) && thread.provider !== config.provider) throw new Error('Provider is fixed after the first message');
    Object.assign(thread, config, { model: config.model, effort: config.effort, updatedAt: Date.now() });
    await this.save();
    return structuredClone(thread);
  }
  recordActivity(id: string, runId: string, update: ActivityUpdate) {
    const thread = this.getThread(id);
    const records = thread.activity ||= [];
    const key = `${runId}:${update.id}`;
    const existing = records.find(item => item.id === key);
    const now = Date.now();
    const { append, ...fields } = update;
    const record = { ...existing, ...fields, id: key, runId, parentId: update.parentId ? `${runId}:${update.parentId}` : existing?.parentId, title: update.title.slice(0, 200), detail: (append ? (existing?.detail || '') + update.detail : update.detail).slice(-20000), createdAt: existing?.createdAt || now, updatedAt: now };
    if (existing) Object.assign(existing, record); else records.push(record);
    if (records.length > 500) records.splice(0, records.length - 500);
    return structuredClone(record);
  }
  recordUsage(id: string, usage: ThreadUsage) {
    const thread = this.getThread(id);
    thread.usage = { ...thread.usage, ...usage };
    return structuredClone(thread.usage);
  }
  async finishActivity(id: string, runId: string, cancelled: boolean) {
    for (const item of this.getThread(id).activity || []) if (item.runId === runId && item.status === 'running') { item.status = cancelled ? 'interrupted' : 'unknown'; item.updatedAt = Date.now(); }
    await this.save();
  }
  async flush() { await this.save(); }
  async removeProject(id: string) {
    this.getProject(id);
    this.state.projects = this.state.projects.filter(item => item.id !== id);
    this.state.threads = this.state.threads.filter(item => item.projectId !== id);
    await this.save();
  }
  async deleteThread(id: string) {
    this.getThread(id);
    this.state.threads = this.state.threads.filter(item => item.id !== id);
    await this.save();
  }
  async appendMessage(id: string, role: Message['role'], text: string, attachments?: Message['attachments'], queuedMessageId?: string) {
    const thread = this.getThread(id);
    const message = { id: randomUUID(), role, text, createdAt: Date.now(), ...(attachments?.length ? {attachments} : {}) };
    if (queuedMessageId) thread.queuedMessages = (thread.queuedMessages || []).filter(item => item.id !== queuedMessageId);
    thread.messages.push(message);
    thread.updatedAt = Date.now();
    if (role === 'user' && thread.title === 'New thread') thread.title = text.replace(/\s+/g, ' ').slice(0, 64) || 'New thread';
    await this.save();
    return structuredClone(message);
  }
  async pinThread(id: string, pinned: boolean) {
    this.getThread(id).pinned = pinned;
    await this.save();
  }
  async updateThread(id: string, update: Partial<Pick<Thread, 'queuedMessages' | 'planning' | 'plan' | 'handoff' | 'sourceThreadId' | 'sessionId' | 'running' | 'model' | 'effort' | 'contextWindow' | 'fastMode' | 'branch' | 'branches' | 'repository' | 'summary' | 'settled' | 'title'>>) {
    const thread = this.getThread(id);
    Object.assign(thread, update);
    thread.updatedAt = Date.now();
    await this.save();
    return structuredClone(thread);
  }
  private async save() {
    const state = JSON.stringify(this.state, null, 2);
    this.saving = this.saving.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(temp, state, { mode: 0o600 });
      await fs.rename(temp, this.file);
    });
    await this.saving;
  }
}
