import { contextBridge, ipcRenderer } from 'electron';
import type { AppEvent, DesktopApi } from '../shared/api.js';

const api: DesktopApi = {
  respondQuestion: (id, threadId, answers) => ipcRenderer.invoke('respond-question', id, threadId, answers),
  handoffPlan: id => ipcRenderer.invoke('handoff-plan', id),
  getComposerItems: (id, provider, kind, query, threadId) => ipcRenderer.invoke('composer-items', id, provider, kind, query, threadId),
  threadPR: id => ipcRenderer.invoke('thread-pr', id),
  pinThread: (id, pinned) => ipcRenderer.invoke('pin-thread', id, pinned),
  settleThread: (id, settled) => ipcRenderer.invoke('settle-thread', id, settled),
  respondApproval: (id, threadId, allow) => ipcRenderer.invoke('respond-approval', id, threadId, allow),
  summarizeThread: (id, provider, model) => ipcRenderer.invoke('summarize-thread', id, provider, model),
  setAppearance: theme => ipcRenderer.invoke('appearance', theme),
  getAppInfo: () => ipcRenderer.invoke('app-info'),
  pickAttachments: () => ipcRenderer.invoke('pick-attachments'),
  importAttachment: (name, bytes) => ipcRenderer.invoke('import-attachment', name, bytes),
  copyText: text => ipcRenderer.invoke('copy-text', text),
  getUpdateStatus: () => ipcRenderer.invoke('update-status'),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  getSnapshot: () => ipcRenderer.invoke('snapshot'),
  setProviderEnabled: (provider, enabled) => ipcRenderer.invoke('provider-enabled', provider, enabled),
  discover: () => ipcRenderer.invoke('discover'),
  getModels: provider => ipcRenderer.invoke('models', provider),
  pickProject: () => ipcRenderer.invoke('pick-project'),
  removeProject: projectId => ipcRenderer.invoke('remove-project', projectId),
  createThread: (projectId, provider, mode, model, effort, workspace) => ipcRenderer.invoke('create-thread', projectId, provider, mode, model, effort, workspace),
  updateThreadConfig: (threadId, config) => ipcRenderer.invoke('configure-thread', threadId, config),
  updateThreadModel: (threadId, model) => ipcRenderer.invoke('update-thread-model', threadId, model),
  deleteThread: threadId => ipcRenderer.invoke('delete-thread', threadId),
  send: (threadId, prompt, attachments, options) => ipcRenderer.invoke('send', threadId, prompt, attachments, options),
  cancel: threadId => ipcRenderer.invoke('cancel', threadId),
  getWorkspace: id => ipcRenderer.invoke('workspace-info', id),
  getProjectBranch: projectId => ipcRenderer.invoke('project-branch', projectId),
  getGit: (projectId, threadId) => ipcRenderer.invoke('git-status', projectId, threadId),
  getDiff: (projectId, file, threadId) => ipcRenderer.invoke('git-diff', projectId, file, threadId),
  commit: input => ipcRenderer.invoke('git-commit', input),
  generateCommitMessage: input => ipcRenderer.invoke('generate-commit-message', input),
  push: (projectId, threadId) => ipcRenderer.invoke('git-push', projectId, threadId),
  createPR: input => ipcRenderer.invoke('create-pr', input),
  openExternal: url => ipcRenderer.invoke('open-external', url),
  onEvent: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: AppEvent) => callback(value);
    ipcRenderer.on('j2code-event', listener);
    return () => ipcRenderer.removeListener('j2code-event', listener);
  }
};
contextBridge.exposeInMainWorld('j2code', api);
