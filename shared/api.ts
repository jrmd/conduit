export interface WorkspaceChoice { mode: 'local' | 'worktree'; branch?: string; newBranch?: string; }
export interface ThreadWorkspace { path: string; mode: 'local' | 'worktree'; }
export interface WorkspaceInfo { isRepository: boolean; current: string; branches: string[]; }
export type ApprovalMode = 'supervised' | 'auto-edits' | 'auto' | 'full-access';
export type ThreadMode = ApprovalMode | 'read' | 'edit';
export interface ApprovalRequest { id: string; threadId: string; title: string; detail: string; }
export type ProviderId = 'codex' | 'claude' | 'cursor' | 'opencode' | 'copilot';
export type Role = 'user' | 'assistant' | 'system';
export interface Attachment { id: string; name: string; mime: string; size: number; preview?: string; }
export interface UpdateStatus { state: 'idle' | 'checking' | 'downloading' | 'ready' | 'current' | 'error' | 'unsupported'; version?: string; percent?: number; message?: string; }
export interface Message { attachments?: Attachment[]; id: string; role: Role; text: string; createdAt: number; }
export interface ModelSettings { contextWindow?: number; fastMode?: boolean; }
export interface Thread extends ModelSettings { workspace?: ThreadWorkspace; branch?: string; branches?: string[]; repository?: string; summary?: string; settled?: boolean; pinned?: boolean; id: string; projectId: string; title: string; provider: ProviderId; mode: ThreadMode; model?: string; effort?: string; activity?: Activity[]; sessionId?: string; messages: Message[]; createdAt: number; updatedAt: number; running?: boolean; }
export interface Project { id: string; name: string; path: string; createdAt: number; }
export interface ProviderInfo { id: ProviderId; name: string; available: boolean; path?: string; version?: string; error?: string; }
export interface ModelOption { id: string; label: string; source: 'discovered' | 'alias'; efforts?: string[]; contextWindows?: number[]; supportsFastMode?: boolean; }
export interface ModelCatalogue { provider: ProviderId; options: ModelOption[]; warning?: string; }
export interface ThreadConfig extends ModelSettings { provider: ProviderId; model?: string; effort?: string; mode: ThreadMode; }
export interface Activity { id: string; runId: string; kind: 'reasoning' | 'tool' | 'agent' | 'status'; title: string; detail: string; status: 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown'; parentId?: string; agentId?: string; createdAt: number; updatedAt: number; }
export type ActivityUpdate = Omit<Activity, 'runId' | 'createdAt' | 'updatedAt'> & { append?: boolean };
export interface Snapshot { approvals?: ApprovalRequest[]; projects: Project[]; threads: Thread[]; providers: ProviderInfo[]; disabledProviders: ProviderId[]; }
export interface ChangedFile { path: string; previousPath?: string; status: string; staged: boolean; unstaged: boolean; untracked: boolean; }
export interface GitStatus { branch: string; files: ChangedFile[]; ahead: number; behind: number; remote?: string; pushTarget?: string; isRepository: boolean; }
export type AppEvent = { type: 'approvals'; approvals: ApprovalRequest[] } | { type: 'activity'; threadId: string; activity: Activity } | { type: 'snapshot'; snapshot: Snapshot } | { type: 'thread'; thread: Thread } | { type: 'provider'; threadId: string; kind: 'text' | 'status' | 'error' | 'tool'; text: string };
export interface CommitInput { threadId?: string; projectId: string; files: string[]; message: string; }
export interface PRInput { threadId?: string; projectId: string; title: string; body: string; base?: string; draft: boolean; }
export interface ComposerItem { id: string; kind: 'file' | 'skill' | 'plugin'; name: string; description: string; token: string; path?: string; }
export interface SendOptions { title?: { provider: ProviderId; model?: string }; references?: string[]; }
export interface DesktopApi {
  respondApproval(id: string, threadId: string, allow: boolean): Promise<void>;
  getComposerItems(projectId: string, provider: ProviderId, kind: 'file' | 'capability', query: string, threadId?: string): Promise<{items: ComposerItem[]; warning?: string}>;
  threadPR(threadId: string): Promise<{number: number; url: string; state: string; title: string} | null>;
  pinThread(threadId: string, pinned: boolean): Promise<void>;
  settleThread(threadId: string, settled: boolean): Promise<void>;
  summarizeThread(threadId: string, provider: ProviderId, model?: string): Promise<void>;
  setAppearance(theme: 'system' | 'light' | 'dark'): Promise<void>;
  getAppInfo(): Promise<{ version: string; platform: string }>;
  pickAttachments(): Promise<Attachment[]>;
  importAttachment(name: string, bytes: Uint8Array): Promise<Attachment>;
  copyText(text: string): Promise<void>;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  getSnapshot(): Promise<Snapshot>;
  setProviderEnabled(provider: ProviderId, enabled: boolean): Promise<void>;
  discover(): Promise<ProviderInfo[]>;
  getModels(provider: ProviderId): Promise<ModelCatalogue>;
  pickProject(): Promise<Project | null>;
  removeProject(projectId: string): Promise<void>;
  createThread(projectId: string, provider: ProviderId, mode: ThreadMode, model?: string, effort?: string, workspace?: WorkspaceChoice): Promise<Thread>;
  updateThreadConfig(threadId: string, config: ThreadConfig): Promise<Thread>;
  updateThreadModel(threadId: string, model?: string): Promise<Thread>;
  deleteThread(threadId: string): Promise<void>;
  send(threadId: string, prompt: string, attachments?: string[], options?: SendOptions): Promise<void>;
  cancel(threadId: string): Promise<void>;
  getWorkspace(projectId: string): Promise<WorkspaceInfo>;
  getProjectBranch(projectId: string): Promise<string | null>;
  getGit(projectId: string, threadId?: string): Promise<GitStatus>;
  getDiff(projectId: string, file: string, threadId?: string): Promise<string>;
  commit(input: CommitInput): Promise<string>;
  push(projectId: string, threadId?: string): Promise<string>;
  createPR(input: PRInput): Promise<string>;
  openExternal(url: string): Promise<void>;
  onEvent(callback: (event: AppEvent) => void): () => void;
}
declare global { interface Window { j2code: DesktopApi; } }
