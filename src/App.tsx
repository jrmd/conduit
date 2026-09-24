import { useAppearance } from './appearance';
import { JrmdShader } from './JrmdShader.webgl';
import { ProjectPicker } from './ProjectPicker';
import { SimpleIconsOpenai } from './icons/openai';
import { SimpleIconsClaude } from './icons/claude';
import { SimpleIconsCursor } from './icons/cursor';
import { SimpleIconsOpencode } from './icons/opencode';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy, Paperclip, Download, Sparkles, Atom, Asterisk, MousePointer2, Zap, ArrowUp, Check, ChevronDown, ChevronRight, CircleAlert,
  CircleCheck, Code2, File, FileCode2, FileDiff, Folder, FolderOpen,
  GitBranch, GitCommitHorizontal, GitPullRequest, LoaderCircle, Menu,
  MessageSquare, Plus, RefreshCw, Search, Settings2, Square, Terminal, Trash2, X,
} from 'lucide-react';
import { ActivityFeed } from './ActivityFeed';
import { MessageMarkdown } from './MessageMarkdown';
import type { Attachment, UpdateStatus, ChangedFile, GitStatus, ModelCatalogue, Project, ProviderId, Snapshot } from '../shared/api';

type Dialog = 'commit' | 'push' | 'pr' | 'delete' | 'removeProject' | null;
type Toast = { text: string; kind: 'success' | 'error' } | null;

const providerNames: Record<ProviderId, string> = {
  codex: 'Codex', claude: 'Claude Code', cursor: 'Cursor', opencode: 'OpenCode',
};
const providerIcons = { codex: SimpleIconsOpenai, claude: SimpleIconsClaude, cursor: SimpleIconsCursor, opencode: SimpleIconsOpencode };
const effortRanks = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

const initialGit: GitStatus = { branch: '', files: [], ahead: 0, behind: 0, isRepository: false };

function timeAgo(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

function fileName(path: string): string { return path.split('/').pop() || path; }
function fileDir(path: string): string { return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; }
function fileBadge(file: ChangedFile): string {
  if (file.untracked) return 'U';
  const status = file.status.trim();
  if (status.includes('D')) return 'D';
  if (status.includes('A') || status.includes('?')) return 'A';
  if (status.includes('R')) return 'R';
  return 'M';
}

export default function App() {
  const { appearance, setAppearance, theme } = useAppearance();
  const [snapshot, setSnapshot] = useState<Snapshot>({ projects: [], threads: [], providers: [], disabledProviders: [] });
  const [attachmentDrafts,setAttachmentDrafts] = useState<Record<string,Attachment[]>>({});
  const [attaching,setAttaching] = useState(false);
  const [copiedId,setCopiedId] = useState<string|null>(null);
  const [updateStatus,setUpdateStatus] = useState<UpdateStatus>({state:'idle'});
  const [contextMenu, setContextMenu] = useState<{x:number;y:number;projectId:string;threadId?:string}|null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appInfo, setAppInfo] = useState({ version: '', platform: '' });
  useEffect(() => { window.j2code.getAppInfo().then(setAppInfo).catch(console.error); }, []);
  const [loading, setLoading] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('codex');
  const [selectedEffort, setSelectedEffort] = useState('');
  const [effortOpen, setEffortOpen] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'read' | 'edit'>('edit');
  const [selectedModels, setSelectedModels] = useState<Partial<Record<ProviderId, string>>>({});
  const [modelCatalogues, setModelCatalogues] = useState<Partial<Record<ProviderId, ModelCatalogue>>>({});
  const [modelOpen, setModelOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState<ProviderId | 'all'>('all');
  const [modelQuery, setModelQuery] = useState('');
  const [modelBusy, setModelBusy] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [git, setGit] = useState<GitStatus>(initialGit);
  const [gitLoading, setGitLoading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [projectToRemove, setProjectToRemove] = useState<Project | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [prDraft, setPrDraft] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [activityByThread, setActivityByThread] = useState<Record<string, string>>({});
  const [streamByThread, setStreamByThread] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const gitRequestRef = useRef(0);
  const diffRequestRef = useRef(0);
  const activeProjectRef = useRef<string | null>(null);

  const activeProject = useMemo(() => snapshot.projects.find(p => p.id === activeProjectId) || null, [snapshot.projects, activeProjectId]);
  const activeThread = useMemo(() => snapshot.threads.find(t => t.id === activeThreadId) || null, [snapshot.threads, activeThreadId]);
  const providerLocked = !!activeThread && (activeThread.messages.some(message => message.role === 'user') || !!activeThread.sessionId || !!activeThread.running);
  const activeEffort = activeThread ? activeThread.effort || '' : selectedEffort;
  const activeProvider = activeThread?.provider || selectedProvider;
  const ProviderIcon = providerIcons[activeProvider];
  const activeModel = activeThread ? activeThread.model || '' : selectedModels[activeProvider] || '';
  const modelCatalogue = modelCatalogues[activeProvider];
  const effortChoices = modelCatalogue?.options.find(option => option.id === activeModel)?.efforts || [];
  const enabledProviders = snapshot.providers.filter(provider => !snapshot.disabledProviders.includes(provider.id));
  const pickerProviders = enabledProviders.filter(provider => provider.available && (!providerLocked || provider.id === activeThread?.provider) && (modelFilter === 'all' || provider.id === modelFilter));
  const providerEnabled = !snapshot.disabledProviders.includes(activeProvider);
  const draftKey = activeThreadId || `new:${activeProjectId || 'none'}`;
  const draft = drafts[draftKey] || '';
  const draftAttachments = attachmentDrafts[draftKey] || [];
  useEffect(() => {
    let alive=true;
    const refresh=()=>window.j2code.getUpdateStatus().then(status=>{if(alive)setUpdateStatus(status)}).catch(()=>{});
    void refresh();const timer=setInterval(refresh,2000);return()=>{alive=false;clearInterval(timer)};
  },[]);
  const setDraft = (value: string) => setDrafts(previous => ({ ...previous, [draftKey]: value }));
  const activeActivity = activeThreadId ? activityByThread[activeThreadId] || '' : '';
  const activeStream = activeThreadId ? streamByThread[activeThreadId] || '' : '';
  const providerInstalled = snapshot.providers.some(provider => provider.id === activeProvider && provider.available);

  useEffect(() => {
    let mounted = true;
    if (!providerInstalled || !providerEnabled || modelCatalogues[activeProvider]) return;
    window.j2code.getModels(activeProvider).then(catalogue => {
      if (mounted) setModelCatalogues(previous => ({ ...previous, [activeProvider]: catalogue }));
    }).catch(error => {
      if (mounted) setModelCatalogues(previous => ({ ...previous, [activeProvider]: { provider: activeProvider, options: [], warning: String(error) } }));
    });
    return () => { mounted = false; };
  }, [activeProvider, providerInstalled, providerEnabled, modelCatalogues]);

  useEffect(() => {
    if (!modelOpen) return;
    let mounted = true;
    for (const provider of snapshot.providers) {
      if (!provider.available || snapshot.disabledProviders.includes(provider.id) || modelCatalogues[provider.id]) continue;
      window.j2code.getModels(provider.id).then(catalogue => {
        if (mounted) setModelCatalogues(previous => ({ ...previous, [provider.id]: catalogue }));
      }).catch(error => {
        if (mounted) setModelCatalogues(previous => ({ ...previous, [provider.id]: { provider: provider.id, options: [], warning: String(error) } }));
      });
    }
    return () => { mounted = false; };
  }, [modelOpen, snapshot.providers, snapshot.disabledProviders]);

  useEffect(() => {
    if (activeThread || !snapshot.disabledProviders.includes(selectedProvider)) return;
    const next = snapshot.providers.find(provider => provider.available && !snapshot.disabledProviders.includes(provider.id));
    if (next) setSelectedProvider(next.id);
  }, [snapshot.disabledProviders, snapshot.providers, activeThread, selectedProvider]);

  const notify = useCallback((text: string, kind: 'success' | 'error' = 'success') => {
    setToast({ text, kind });
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  const refreshGit = useCallback(async (projectId: string) => {
    const request = ++gitRequestRef.current;
    setGitLoading(true);
    try {
      const result = await window.j2code.getGit(projectId);
      if (request !== gitRequestRef.current || projectId !== activeProjectRef.current) return;
      setGit(result);
      setSelectedFiles(previous => previous.filter(path => result.files.some(file => file.path === path)));
    } catch (error) { if (request === gitRequestRef.current) notify(String(error), 'error'); }
    finally { if (request === gitRequestRef.current) setGitLoading(false); }
  }, [notify]);

  useEffect(() => {
    let mounted = true;
    const off = window.j2code.onEvent(event => {
      if (!mounted) return;
      if (event.type === 'snapshot') {
        setSnapshot(event.snapshot);
        setStreamByThread(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => event.snapshot.threads.some(thread => thread.id === id && thread.running))));
        setActivityByThread(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => event.snapshot.threads.some(thread => thread.id === id && thread.running))));
        if (activeProjectRef.current) refreshGit(activeProjectRef.current);
      }
      if (event.type === 'activity') {
        setSnapshot(previous => ({ ...previous, threads: previous.threads.map(thread => thread.id !== event.threadId ? thread : { ...thread, activity: [...(thread.activity || []).filter(item => item.id !== event.activity.id), event.activity].sort((a,b) => a.createdAt - b.createdAt).slice(-500) }) }));
      }
      if (event.type === 'thread') {
        setSnapshot(previous => ({ ...previous, threads: previous.threads.some(thread => thread.id === event.thread.id)
          ? previous.threads.map(thread => thread.id === event.thread.id ? event.thread : thread)
          : [event.thread, ...previous.threads] }));
        if (!event.thread.running) {
          setActivityByThread(previous => ({ ...previous, [event.thread.id]: '' }));
          setStreamByThread(previous => ({ ...previous, [event.thread.id]: '' }));
          if (event.thread.projectId === activeProjectRef.current) refreshGit(event.thread.projectId);
        }
      }
      if (event.type === 'provider') {
        if (event.kind === 'text') setStreamByThread(previous => ({ ...previous, [event.threadId]: (previous[event.threadId] || '') + event.text }));
        if (event.kind === 'status' || event.kind === 'tool') setActivityByThread(previous => ({ ...previous, [event.threadId]: event.text }));
        if (event.kind === 'error') { setActivityByThread(previous => ({ ...previous, [event.threadId]: '' })); notify(event.text, 'error'); }
      }
    });
    window.j2code.getSnapshot().then(data => {
      if (!mounted) return;
      setSnapshot(data);
      const firstProject = data.projects[0];
      if (firstProject) {
        setActiveProjectId(firstProject.id);
        const firstThread = data.threads.filter(t => t.projectId === firstProject.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
        setActiveThreadId(firstThread?.id || null);
      }
      const provider = data.providers.find(p => p.available && !data.disabledProviders.includes(p.id));
      if (provider) setSelectedProvider(provider.id);
    }).catch(error => notify(String(error), 'error')).finally(() => { if (mounted) setLoading(false); });
    window.j2code.discover().then(providers => {
      if (mounted) setSnapshot(previous => ({ ...previous, providers }));
    }).catch(() => {});
    return () => { mounted = false; off(); };
  }, [notify, refreshGit]);

  useEffect(() => {
    activeProjectRef.current = activeProjectId;
    gitRequestRef.current++;
    diffRequestRef.current++;
    setGit(initialGit);
    setSelectedFiles([]);
    setGitLoading(false);
    if (activeProjectId) refreshGit(activeProjectId);
    setSelectedFile(null);
    setDiff('');
  }, [activeProjectId, refreshGit]);

  useEffect(() => {
    nearBottomRef.current = true;
    requestAnimationFrame(() => { const el = messagesScrollRef.current; if (el) el.scrollTop = el.scrollHeight; });
  }, [activeThreadId]);
  useEffect(() => {
    if (!nearBottomRef.current) return;
    requestAnimationFrame(() => { const el = messagesScrollRef.current; if (el) el.scrollTop = el.scrollHeight; });
  }, [activeThread?.messages.length, activeThread?.messages.at(-1)?.text, activeActivity, activeStream, activeThread?.activity]);

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (event.key === 'Escape' && settingsOpen) { setSettingsOpen(false); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n' && activeProjectId) {
        event.preventDefault();
        setActiveThreadId(null);
        setSettingsOpen(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [activeProjectId, settingsOpen]);

  useEffect(() => {
    const input = inputRef.current;
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 200)}px`; }
  }, [draft, activeProjectId, activeThreadId, settingsOpen]);

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (!(event.target instanceof Element) || !event.target.closest('.model-wrap, .provider-wrap, .effort-wrap')) {
        setModelOpen(false); setProviderOpen(false); setEffortOpen(false);
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') { setModelOpen(false); setProviderOpen(false); setEffortOpen(false); }
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, []);

  useEffect(() => { setModelOpen(false); setProviderOpen(false); setEffortOpen(false); }, [activeThreadId, activeProjectId]);

  useEffect(() => {
    const onResize = () => { if (window.innerWidth <= 900) setChangesOpen(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  async function pickProject() {
    try {
      const project = await window.j2code.pickProject();
      if (project) {
        setSnapshot(previous => ({ ...previous, projects: previous.projects.some(p => p.id === project.id) ? previous.projects : [...previous.projects, project] }));
        activeProjectRef.current = project.id;
        setActiveProjectId(project.id);
        setActiveThreadId(null);
        setSelectedFiles([]);
        setGit(initialGit);
        setDialog(null);
        setExpandedProjects(previous => ({ ...previous, [project.id]: true }));
        setSidebarOpen(false);
      }
    } catch (error) { notify(String(error), 'error'); }
  }

  async function send() {
    const text = draft.trim() || (draftAttachments.length ? 'Please review the attached files.' : '');
    if (!text || !activeProjectId || sending || !providerInstalled) return;
    setSending(true);
    if (activeThreadId) setActivityByThread(previous => ({ ...previous, [activeThreadId]: '' }));
    let threadId = activeThreadId;
    try {
      if (!threadId) {
        const thread = await window.j2code.createThread(activeProjectId, selectedProvider, selectedProvider === 'codex' || selectedProvider === 'claude' ? selectedMode : 'edit', selectedModels[selectedProvider] || undefined, selectedEffort || undefined);
        setSnapshot(previous => ({ ...previous, threads: [thread, ...previous.threads.filter(existing => existing.id !== thread.id)] }));
        setActiveThreadId(thread.id);
        threadId = thread.id;
      }
      await window.j2code.send(threadId, text, draftAttachments.map(file=>file.id));
      setAttachmentDrafts(previous=>({...previous,[draftKey]:[],[threadId!]:[]}));
      const acceptedThreadId = threadId;
      setDrafts(previous => ({ ...previous, [draftKey]: '', [acceptedThreadId]: '' }));
    } catch (error) {
      if (threadId) { const failedThreadId = threadId; setAttachmentDrafts(previous=>({...previous,[failedThreadId]:draftAttachments})); setDrafts(previous => ({ ...previous, [failedThreadId]: text })); }
      notify(String(error), 'error');
    } finally { setSending(false); }
  }

  async function attachFiles(files?: File[]) {
    if (attaching || activeThread?.running || sending) return;
    const key=draftKey;
    setAttaching(true);
    try {
      if(files && files.length + draftAttachments.length > 10) throw new Error('Attach up to 10 files');
      const added = files ? await Promise.all(files.map(async file => {
        if(file.size > 20*1024*1024) throw new Error('Files must be 20 MB or smaller');
        return window.j2code.importAttachment(file.name,new Uint8Array(await file.arrayBuffer()));
      })) : await window.j2code.pickAttachments();
      if(draftAttachments.length+added.length>10)throw new Error('Attach up to 10 files');
      setAttachmentDrafts(previous=>({...previous,[key]:[...(previous[key]||[]),...added]}));
    } catch(error) {notify(String(error),'error')} finally {setAttaching(false)}
  }

  async function chooseFile(file: string) {
    if (!activeProjectId) return;
    const projectId = activeProjectId;
    const request = ++diffRequestRef.current;
    setSelectedFile(file);
    setDiff('');
    setDiffLoading(true);
    try { const result = await window.j2code.getDiff(projectId, file); if (request === diffRequestRef.current && projectId === activeProjectRef.current) setDiff(result); }
    catch (error) { if (request === diffRequestRef.current) setDiff(String(error)); }
    finally { if (request === diffRequestRef.current) setDiffLoading(false); }
  }

  async function performAction() {
    if (!dialog || busy || (dialog !== 'removeProject' && !activeProjectId)) return;
    const projectId = activeProjectId;
    setBusy(true);
    try {
      if (dialog === 'removeProject' && projectToRemove) {
        await window.j2code.removeProject(projectToRemove.id);
        setSnapshot(previous => ({ ...previous, projects: previous.projects.filter(project => project.id !== projectToRemove.id), threads: previous.threads.filter(thread => thread.projectId !== projectToRemove.id) }));
        if (activeProjectId === projectToRemove.id) {
          const nextProject = snapshot.projects.find(project => project.id !== projectToRemove.id);
          activeProjectRef.current = nextProject?.id || null;
          setActiveProjectId(nextProject?.id || null);
          setActiveThreadId(nextProject ? snapshot.threads.filter(thread => thread.projectId === nextProject.id).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id || null : null);
          setGit(initialGit);
          setSelectedFiles([]);
        }
        setProjectToRemove(null);
        setDialog(null);
        notify('Project removed from J2Code');
        return;
      }
      if (!projectId) return;
      if (dialog === 'commit') {
        if (!commitMessage.trim() || selectedFiles.length === 0) return;
        await window.j2code.commit({ projectId, files: selectedFiles, message: commitMessage.trim() });
        setCommitMessage(''); setSelectedFiles([]); notify('Changes committed');
      }
      if (dialog === 'push') { if (!git.pushTarget) return; await window.j2code.push(projectId); notify('Changes pushed'); }
      if (dialog === 'pr') {
        if (!git.pushTarget || git.ahead > 0) return;
        const url = await window.j2code.createPR({ projectId, title: prTitle.trim(), body: prBody.trim(), draft: prDraft });
        notify('Pull request created');
        await window.j2code.openExternal(url);
      }
      if (dialog === 'delete' && activeThreadId) {
        await window.j2code.deleteThread(activeThreadId);
        setSnapshot(previous => ({ ...previous, threads: previous.threads.filter(t => t.id !== activeThreadId) }));
        setActiveThreadId(null);
        notify('Thread deleted');
      }
      setDialog(null);
      await refreshGit(projectId);
    } catch (error) { notify(String(error), 'error'); }
    finally { setBusy(false); }
  }

  function selectProject(project: Project) {
    setSettingsOpen(false);
    activeProjectRef.current = project.id;
    setActiveProjectId(project.id);
    setSelectedFiles([]);
    setGit(initialGit);
    setDialog(null);
    const thread = snapshot.threads.filter(t => t.projectId === project.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    setActiveThreadId(thread?.id || null);
    setSidebarOpen(false);
  }

  async function chooseModel(model: string, provider: ProviderId = activeProvider) {
    const value = model.trim();
    if (modelBusy || activeThread?.running || snapshot.disabledProviders.includes(provider) || (providerLocked && activeThread?.provider !== provider)) return;
    if (value && (value.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:/+@-]*(?:\[[A-Za-z0-9]+\])?$/.test(value))) {
      notify('Enter an exact model ID using letters, numbers, and . _ : / + @ -', 'error');
      return;
    }
    setModelBusy(true);
    try {
      if (activeThread) {
        const updated = await window.j2code.updateThreadConfig(activeThread.id, { provider, mode: activeThread.mode, model: value || undefined, effort: undefined });
        setSnapshot(previous => ({ ...previous, threads: previous.threads.map(thread => thread.id === updated.id ? updated : thread) }));
      } else {
        setSelectedEffort('');
        setSelectedProvider(provider);
        setSelectedModels(previous => ({ ...previous, [provider]: value }));
      }
      setModelOpen(false);
      setModelQuery('');
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (error) { notify(String(error), 'error'); }
    finally { setModelBusy(false); }
  }

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    window.addEventListener('click', dismiss); window.addEventListener('keydown', key); window.addEventListener('resize', dismiss);
    return () => { window.removeEventListener('click', dismiss); window.removeEventListener('keydown', key); window.removeEventListener('resize', dismiss); };
  }, [contextMenu]);
  const changedCount = git.files.length;
  const canSend = (!!draft.trim() || !!draftAttachments.length) && !attaching && !!activeProject && !!providerInstalled && providerEnabled && !modelBusy && !sending && (activeThread ? !activeThread.running : true);

  return <div className={`app-shell platform-${appInfo.platform}`}>
    {contextMenu && <div className="workspace-context-menu" role="menu" aria-label="Workspace actions" style={{left:Math.min(contextMenu.x,window.innerWidth-210),top:Math.min(contextMenu.y,window.innerHeight-140)}}>
      <button autoFocus role="menuitem" onClick={() => { const project=snapshot.projects.find(p=>p.id===contextMenu.projectId);if(project){selectProject(project);setActiveThreadId(null);} }}><Plus size={14}/>New thread here</button>
      {contextMenu.threadId ? <button role="menuitem" onClick={() => {setActiveProjectId(contextMenu.projectId);setActiveThreadId(contextMenu.threadId!);setDialog('delete');}}><Trash2 size={14}/>Delete thread…</button> : <button role="menuitem" onClick={() => {setProjectToRemove(snapshot.projects.find(p=>p.id===contextMenu.projectId)!);setDialog('removeProject');}}><X size={14}/>Remove project…</button>}
    </div>}
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-top">
        <div className="brand" title="Vulp"><img className="vulp-brand-logo" src="./vulp-logo.jpg" alt="Vulp" /></div>
        <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar"><X size={17} /></button>
      </div>
      <div className="sidebar-content">
        <button className="new-thread-button" disabled={!activeProject} onClick={() => { setSettingsOpen(false); setActiveThreadId(null); requestAnimationFrame(() => inputRef.current?.focus()); }}><Plus size={16} />New thread<kbd>{appInfo.platform === 'darwin' ? '⌘ N' : 'Ctrl N'}</kbd></button>
        <div className="section-heading projects-heading"><span>Projects</span><button className="icon-button" onClick={pickProject} title="Open project folder" aria-label="Open project folder"><Plus size={16} /></button></div>
        <div className="project-tree">
          {snapshot.projects.map(project => {
            const threads = snapshot.threads.filter(t => t.projectId === project.id).sort((a, b) => b.updatedAt - a.updatedAt);
            const expanded = expandedProjects[project.id] ?? true;
            return <div className="project-group" key={project.id}>
              <div className={`project-row ${activeProjectId === project.id ? 'active' : ''}`} onContextMenu={event => { event.preventDefault(); setContextMenu({x:event.clientX,y:event.clientY,projectId:project.id}); }}>
                <button className="project-disclosure" onClick={() => setExpandedProjects(previous => ({ ...previous, [project.id]: !expanded }))} title={expanded ? 'Collapse project' : 'Expand project'} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`}><ChevronRight size={14} className={expanded ? 'rotate-down' : ''} /></button>
                <button className="project-title" onClick={() => selectProject(project)} title={project.path}><Folder size={14} /><span>{project.name}</span></button>
                <button className="project-row-action" onClick={() => { selectProject(project); setActiveThreadId(null); requestAnimationFrame(() => inputRef.current?.focus()); }} title={`New thread in ${project.name}`} aria-label={`New thread in ${project.name}`}><Plus size={14} /></button>
                <button className="project-row-action remove" onClick={() => { setProjectToRemove(project); setDialog('removeProject'); }} title={`Remove ${project.name}`} aria-label={`Remove ${project.name}`}><X size={13} /></button>
              </div>
              {expanded && <div className="project-threads">
                {threads.map(thread => <button key={thread.id} onContextMenu={event => { event.preventDefault(); setContextMenu({x:event.clientX,y:event.clientY,projectId:project.id,threadId:thread.id}); }} className={`thread-item ${thread.id === activeThreadId ? 'active' : ''}`} onClick={() => { setSettingsOpen(false); setActiveProjectId(project.id); setActiveThreadId(thread.id); setSidebarOpen(false); }}><MessageSquare size={13} /><span className="thread-item-title">{thread.title || 'New thread'}</span>{thread.running ? <LoaderCircle className="spin" size={12} /> : <time>{timeAgo(thread.updatedAt)}</time>}</button>)}
                {threads.length === 0 && <div className="sidebar-empty">No threads yet</div>}
              </div>}
            </div>;
          })}
          {snapshot.projects.length === 0 && <div className="sidebar-empty">Open a local folder to start.</div>}
        </div>
      </div>
      <div className="sidebar-footer"><span className="app-version" title="Installed version">v{appInfo.version || '…'}</span>{updateStatus.state==='ready' ? <button className="update-ready" title="Restart to update" aria-label="Restart to update" onClick={()=>window.j2code.installUpdate().catch(error=>notify(String(error),'error'))}><Download size={13}/></button> : null}<button className={`footer-settings ${settingsOpen ? 'active' : ''}`} title="Agent settings" aria-label="Agent settings" onClick={() => setSettingsOpen(true)}><Settings2 size={15} /><span>Settings</span></button></div>
    </aside>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}

    <main className="main-area">
      {settingsOpen ? <>
        <header className="topbar settings-topbar"><button className="ghost-button" onClick={() => setSettingsOpen(false)}><ChevronRight size={15} className="back-chevron"/>Back to chat</button><strong>Settings</strong></header>
        <section className="settings-screen" aria-label="Settings"><div className="settings-content"><h1>Settings</h1><p className="settings-intro">Vulp <span>v{appInfo.version}</span></p><div className="appearance-settings"><h2>Appearance</h2><p>Choose a theme or follow your system.</p><div className="appearance-options" role="group" aria-label="Appearance">{(['system', 'light', 'dark'] as const).map(value => <button key={value} aria-pressed={appearance === value} onClick={() => setAppearance(value)}>{value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark'}{appearance === value && <Check size={14}/>}</button>)}</div></div><div className="update-settings"><div><strong>Vulp updates</strong><small>{updateStatus.state==='current'?`Version ${updateStatus.version} is current`:updateStatus.state==='downloading'?`Downloading ${updateStatus.version} · ${updateStatus.percent || 0}%`:updateStatus.state==='ready'?`Version ${updateStatus.version} is ready`:updateStatus.message || 'Checks GitHub automatically; restart when you are ready.'}</small></div><button className="ghost-button" disabled={['checking','downloading','unsupported'].includes(updateStatus.state)} onClick={async()=>{try{if(updateStatus.state==='ready')await window.j2code.installUpdate();else setUpdateStatus(await window.j2code.checkForUpdates())}catch(error){notify(String(error),'error')}}}>{updateStatus.state==='ready'?'Restart to update':updateStatus.state==='checking'?'Checking…':'Check for updates'}</button></div><h2>Providers</h2><p>Choose the installed CLIs available in the model picker.</p><div className="agent-list">{(['codex','claude','cursor','opencode'] as ProviderId[]).map(id => { const provider = snapshot.providers.find(p => p.id === id); const Icon = providerIcons[id]; return <div className="agent-row" key={id}><span className="agent-initial"><Icon width={21} height={21}/></span><span><strong>{providerNames[id]}</strong><small>{provider?.available ? provider.version || provider.path || 'Installed · sign-in may be required' : provider?.error || 'Not installed'}</small></span><span className={`agent-state ${provider?.available ? 'installed' : ''}`}>{provider?.available ? 'Installed' : 'Missing'}</span><button className="provider-toggle" role="switch" aria-label={`Enable ${providerNames[id]}`} aria-checked={!snapshot.disabledProviders.includes(id)} disabled={busy} onClick={async () => { setBusy(true); try { await window.j2code.setProviderEnabled(id, snapshot.disabledProviders.includes(id)); setSnapshot(await window.j2code.getSnapshot()); } catch (error) { notify(String(error), 'error'); } finally { setBusy(false); } }}><span /></button></div>; })}</div><button className="ghost-button refresh-agents" onClick={async () => { setBusy(true); try { const providers = await window.j2code.discover(); setSnapshot(previous => ({ ...previous, providers })); notify('Agent discovery refreshed'); } catch (error) { notify(String(error), 'error'); } finally { setBusy(false); } }} disabled={busy}><RefreshCw size={14} className={busy ? 'spin' : ''} />Refresh discovery</button></div></section>
      </> : <>

      <header className="topbar">
        <div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar"><Menu size={18} /></button>{!providerLocked ? <ProjectPicker projects={snapshot.projects} current={activeProject} onSelect={project=>{selectProject(project);setActiveThreadId(null)}} onOpen={pickProject}/> : <span className="breadcrumb-project">{activeProject?.name || 'Workspace'}</span>}<ChevronRight size={14} className="breadcrumb-separator" /><strong>{activeThread?.title || 'New thread'}</strong></div>
        <div className="topbar-actions">
          {activeProject && git.isRepository && <div className="branch-pill"><GitBranch size={14} /><span>{git.branch || 'unknown'}</span></div>}
          
          {activeThread && <button className="icon-button" title="Delete thread" onClick={() => setDialog('delete')}><Trash2 size={16} /></button>}
          <button className={`icon-button changes-toggle ${changesOpen ? 'is-on' : ''}`} title="Toggle changes" aria-label="Toggle changes" aria-expanded={changesOpen} onClick={() => setChangesOpen(!changesOpen)}><FileDiff size={16} /><span>Changes</span>{changedCount > 0 && <span className="count-dot">{changedCount}</span>}</button>
        </div>
      </header>

      <div className="work-area">
        <section className="conversation">
          {loading ? <div className="center-state"><LoaderCircle className="spin" size={24} /><p>Opening workspace…</p></div>
            : !activeProject ? <div className="welcome-state"><JrmdShader theme={theme}/><img className="vulp-hero-logo" src="./vulp-logo.jpg" alt="Vulp fox" /><h1>Open a project</h1><p>Choose a local folder to start working with a coding agent.</p><button className="primary-button" onClick={pickProject}><Plus size={15} /> Open folder</button></div>
            : activeThread && activeThread.messages.length > 0 ? <div className="messages-scroll" ref={messagesScrollRef} onScroll={event => { const el = event.currentTarget; nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; }}><div className="messages-inner">
              {activeThread.messages.map((message, index) => <Fragment key={message.id}><div className={`message message-${message.role}`}>
                <div className={`message-avatar ${message.role === 'assistant' ? 'agent-avatar' : ''}`}>{message.role === 'user' ? 'You' : message.role === 'assistant' ? providerNames[activeThread.provider] : <Terminal size={15} />}</div>
                <div className="message-body"><div className="message-heading"><strong>{message.role === 'user' ? 'You' : message.role === 'assistant' ? providerNames[activeThread.provider] : 'Agent stopped'}</strong><time>{timeAgo(message.createdAt)}</time></div><div className="message-text"><MessageMarkdown text={message.text}/></div>{message.attachments?.length ? <div className="message-attachments">{message.attachments.map(file=><span className="attachment-chip" key={file.id}>{file.preview ? <img src={file.preview} alt={file.name}/> : <File size={16}/>}<span>{file.name}</span></span>)}</div> : null}{message.role==='assistant' && <button className="copy-response" aria-label="Copy response" onClick={async()=>{try{await window.j2code.copyText(message.text);setCopiedId(message.id);setTimeout(()=>setCopiedId(null),1800)}catch(error){notify(String(error),'error')}}}>{copiedId===message.id?<Check size={13}/>:<Copy size={13}/>}<span>{copiedId===message.id?'Copied':'Copy'}</span></button>}</div>
              </div>
              {message.role === 'user' && <ActivityFeed items={(activeThread.activity || []).filter(item => item.createdAt >= message.createdAt && item.createdAt < (activeThread.messages.slice(index + 1).find(next => next.role === 'user')?.createdAt ?? Infinity))} running={activeThread.running && !activeThread.messages.slice(index + 1).some(next => next.role === 'user')} />}
              </Fragment>)}
              {activeStream && <div className="message message-assistant streaming-message"><div className="message-avatar agent-avatar">{providerNames[activeThread.provider]}</div><div className="message-body"><div className="message-heading"><strong>{providerNames[activeThread.provider]}</strong><LoaderCircle className="spin" size={11} /></div><div className="message-text"><MessageMarkdown text={activeStream}/></div></div></div>}

            </div></div>
            : <div className="empty-conversation"><JrmdShader theme={theme}/><img className="vulp-hero-logo" src="./vulp-logo.jpg" alt="Vulp fox" /><h1>New thread</h1><div className="starter-prompts">{[{title:'Explore this project',text:'Explain the architecture of this project and how its main parts fit together.',icon:Code2},{title:'Find a better way',text:'Review this project and suggest the most valuable improvements.',icon:Sparkles},{title:'Solve a problem',text:'Help me investigate a problem in this project: ',icon:Terminal}].map(({title,text,icon:Icon}) => <button key={title} onClick={() => { setDraft(text); inputRef.current?.focus(); }}><Icon size={18}/><span>{title}</span><ArrowUp size={14}/></button>)}</div><span className="hero-project">Working in {activeProject.name}</span></div>}

          {activeProject && <div className="composer-zone">
            {draftAttachments.length>0 && <div className="draft-attachments">{draftAttachments.map(file=><span className="attachment-chip" key={file.id}>{file.preview?<img src={file.preview} alt={file.name}/>:<File size={16}/>}<span>{file.name}<small>{file.mime.startsWith('image/')?'Image': 'Local file'} · {Math.max(1,Math.round(file.size/1024))} KB</small></span><button aria-label={`Remove ${file.name}`} disabled={sending || !!activeThread?.running} onClick={()=>setAttachmentDrafts(previous=>({...previous,[draftKey]:draftAttachments.filter(item=>item.id!==file.id)}))}><X size={12}/></button></span>)}</div>}
              <div className="composer" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();void attachFiles(Array.from(event.dataTransfer.files))}}>
              <textarea onPaste={event=>{const files=Array.from(event.clipboardData.files);if(files.length){event.preventDefault();void attachFiles(files)}}} ref={inputRef} placeholder={providerInstalled ? 'Ask for a change, or ask a question…' : 'Install an agent CLI to start…'} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} disabled={!!activeThread?.running || sending} rows={2} aria-label="Message" />
              <div className="composer-bottom">
                <button className="attach-button" aria-label="Attach files" title="Attach images or files" disabled={attaching || !!activeThread?.running || sending} onClick={()=>attachFiles()}>{attaching?<LoaderCircle size={15} className="spin"/>:<Paperclip size={15}/>}</button>
                <div className="model-wrap">
                  <button className="model-select" data-testid="model-selector" aria-label="Select model" aria-expanded={modelOpen} onClick={() => { setModelOpen(!modelOpen); setProviderOpen(false); setEffortOpen(false); setModelQuery(''); setModelFilter(activeProvider); if (window.innerWidth <= 900) setChangesOpen(false); }} disabled={!!activeThread?.running || modelBusy || (providerLocked && !providerEnabled)}><ProviderIcon style={{width:16,height:16}} /><span className="model-current" title={activeModel || 'CLI default'}>{modelCatalogue?.options.find(option => option.id === activeModel)?.label || activeModel || `${providerNames[activeProvider]} · Default`}</span><ChevronDown size={13} /></button>
                  {modelOpen && <div className="model-menu model-browser" role="dialog" aria-label="Choose a model">
                    <div className="model-provider-filters" role="tablist" aria-label="Providers" aria-orientation="vertical">
                      {enabledProviders.filter(provider => provider.available && (!providerLocked || provider.id === activeProvider)).map(provider => { const Icon = providerIcons[provider.id]; return <button role="tab" aria-selected={modelFilter === provider.id} aria-controls="model-tab-panel" id={`provider-tab-${provider.id}`} key={provider.id} title={provider.id === 'codex' ? 'OpenAI / Codex' : provider.name} aria-label={provider.name} onClick={() => setModelFilter(provider.id)}><Icon style={{width:19,height:19}} /></button>; })}
                      <button title="Manage providers" aria-label="Manage providers" className="model-settings-icon" onClick={() => { setModelOpen(false); setSettingsOpen(true); }}><Settings2 size={16} /></button>
                    </div>
                    <div className="model-tab-content" role="tabpanel" id="model-tab-panel" aria-labelledby={`provider-tab-${modelFilter}`}>
                    <div className="model-search"><Search size={13} /><input aria-label="Search models or enter exact model ID" autoFocus value={modelQuery} onChange={event => setModelQuery(event.target.value)} placeholder="Find a model…" /></div>
                    <div className="model-options">
                      {pickerProviders.map(provider => {
                        const catalogue = modelCatalogues[provider.id];
                        const options = (catalogue?.options || []).filter(option => `${provider.name} ${option.label} ${option.id}`.toLowerCase().includes(modelQuery.trim().toLowerCase()));
                        return <section className="model-provider-group" key={provider.id}>
                          <h3>{provider.name}<span>{options.length} models</span></h3>
                          {!modelQuery.trim() && <button onClick={() => chooseModel('', provider.id)} className={activeProvider === provider.id && !activeModel ? 'selected' : ''}><span><strong>CLI default</strong><small>Let {provider.name} choose</small></span>{activeProvider === provider.id && !activeModel && <Check size={15} />}</button>}
                          {options.map(option => <button key={option.id} className={activeProvider === provider.id && activeModel === option.id ? 'selected' : ''} onClick={() => chooseModel(option.id, provider.id)}><span><strong>{option.label}</strong><small>{option.id}{option.source === 'alias' ? ' · alias' : ''}</small></span>{activeProvider === provider.id && activeModel === option.id && <Check size={15} />}</button>)}
                          {modelQuery.trim() && !options.some(option => option.id === modelQuery.trim()) && <button className="manual-model" onClick={() => chooseModel(modelQuery, provider.id)}><span><strong>Use exact ID: {modelQuery.trim()}</strong><small>With {provider.name}</small></span><Plus size={15} /></button>}
                          {catalogue?.warning && <div className="model-note">{catalogue.warning}</div>}
                          {!catalogue && <div className="model-note">Loading models…</div>}
                        </section>;
                      })}
                      {!pickerProviders.length && <div className="model-note">No enabled, installed providers. Enable a provider in Settings to choose its models.</div>}
                    </div>
                    </div>
                  </div>}
                </div>
                <div className="effort-wrap">
                  <button className={`effort-select effort-${activeEffort || 'auto'}`} aria-label="Reasoning effort" aria-expanded={effortOpen} title={effortChoices.length ? 'Reasoning effort' : 'This model does not advertise effort levels; using CLI default'} disabled={(!effortChoices.length && !activeEffort) || !!activeThread?.running || modelBusy || !providerEnabled} onClick={() => { setEffortOpen(!effortOpen); setModelOpen(false); setProviderOpen(false); }}><Zap size={14} /><span>{activeEffort || 'Auto'}</span><span className="effort-meter" aria-hidden="true">{[0,1,2,3,4,5].map(index => <i key={index} className={index < Math.max(0,effortRanks.indexOf(activeEffort) - 1) ? 'lit' : ''} />)}</span></button>
                  {effortOpen && <div className="effort-menu"><small>Reasoning effort</small>{['', ...effortChoices].map(effort => <button key={effort} className={`effort-${effort || 'auto'}`} aria-pressed={activeEffort === effort} onClick={async () => { setModelBusy(true); try { if (activeThread) await window.j2code.updateThreadConfig(activeThread.id, { provider: activeProvider, mode: activeThread.mode, model: activeModel || undefined, effort: effort || undefined }); else setSelectedEffort(effort); setEffortOpen(false); requestAnimationFrame(() => inputRef.current?.focus()); } catch (error) { notify(String(error), 'error'); } finally { setModelBusy(false); } }}><Zap size={14} /><span>{effort || 'Auto'}</span>{activeEffort === effort && <Check size={13} />}</button>)}</div>}
                </div>
                {(activeProvider === 'codex' || activeProvider === 'claude') && <button className="mode-select" disabled={!!activeThread?.running || sending || modelBusy} onClick={async () => { const mode = (activeThread?.mode || selectedMode) === 'edit' ? 'read' : 'edit'; if (activeThread) { try { await window.j2code.updateThreadConfig(activeThread.id, { provider: activeProvider, model: activeModel || undefined, effort: activeEffort || undefined, mode }); } catch (error) { notify(String(error), 'error'); } } else setSelectedMode(mode); }} title={activeThread?.running ? 'Stop the current run to change permissions' : 'Permissions for the next message'}>{activeThread?.mode === 'read' || (!activeThread && selectedMode === 'read') ? 'Read only' : 'Edit files'}<ChevronDown size={13} /></button>}
                
              
                {activeThread?.running ? <button className="send-button stop-button" onClick={() => window.j2code.cancel(activeThread.id)} title="Stop generation" aria-label="Stop generation"><Square size={13} fill="currentColor" /></button> : <button className="send-button" onClick={send} disabled={!canSend} title="Send message" aria-label="Send message">{sending ? <LoaderCircle size={16} className="spin" /> : <ArrowUp size={17} />}</button>}
              </div>
            </div>
            {!providerEnabled && <div className="composer-footnote">This provider is disabled. <button className="markdown-link" onClick={() => setSettingsOpen(true)}>Enable it in Settings</button> to send messages.</div>}
            {!providerInstalled && <div className="composer-footnote">No agent CLI found. Install one and refresh discovery in Settings.</div>}
          </div>}
        </section>

        <aside className={`changes-panel ${changesOpen ? 'changes-visible' : ''}`}>
          <div className="changes-header"><div><span className="panel-title">Changes</span>{changedCount > 0 && <span className="changes-count">{changedCount}</span>}</div><div className="changes-header-actions"><button className="icon-button" title="Refresh changes" onClick={() => activeProjectId && refreshGit(activeProjectId)} disabled={!activeProjectId}><RefreshCw size={15} className={gitLoading ? 'spin' : ''} /></button><button className="icon-button changes-close" title="Close changes" onClick={() => setChangesOpen(false)}><X size={16} /></button></div></div>
          <div className={`changes-scroll ${selectedFile ? 'reviewing-diff' : ''}`}>{!activeProject ? <div className="changes-empty"><Folder size={23} /><strong>No project open</strong><span>Open a folder to see its changes.</span></div> : !git.isRepository ? <div className="changes-empty"><GitBranch size={23} /><strong>No Git repository</strong><span>Git changes will appear here when this folder is a repository.</span></div> : <>
            <div className="repo-summary"><GitBranch size={15} /><strong>{git.branch}</strong><span>{git.ahead > 0 ? `↑ ${git.ahead}` : ''}{git.behind > 0 ? ` ↓ ${git.behind}` : ''}</span></div>
            {changedCount === 0 ? <div className="changes-empty clean"><CircleCheck size={25} /><strong>All clear</strong><span>Your working tree is clean.</span></div> : <><div className="file-list-heading"><span>MODIFIED FILES</span><span>{changedCount}</span></div><div className="file-list">{git.files.map(file => <div key={file.path} className={`file-row ${selectedFile === file.path ? 'file-selected' : ''}`}><label className="file-check" title="Select for commit"><input type="checkbox" checked={selectedFiles.includes(file.path)} onChange={() => setSelectedFiles(previous => previous.includes(file.path) ? previous.filter(path => path !== file.path) : [...previous, file.path])} /><span><Check size={10} /></span></label><button className="file-open" onClick={() => chooseFile(file.path)}><FileCode2 size={16} /><span className="file-detail"><strong>{fileName(file.path)}</strong>{fileDir(file.path) && <small>{fileDir(file.path)}</small>}</span><span className={`file-status status-${fileBadge(file).toLowerCase()}`}>{fileBadge(file)}</span></button></div>)}</div></>}
            {selectedFile && <div className="diff-card"><div className="diff-heading"><FileDiff size={14} /><span title={selectedFile}>{fileName(selectedFile)}</span><button onClick={() => setSelectedFile(null)} aria-label="Close diff"><X size={13} /></button></div><div className="diff-content">{diffLoading ? <LoaderCircle className="spin" size={18} /> : diff ? diff.split('\n').map((line, index) => <div key={index} className={`diff-line ${line.startsWith('+') && !line.startsWith('+++') ? 'added' : line.startsWith('-') && !line.startsWith('---') ? 'removed' : line.startsWith('@@') ? 'hunk' : ''}`}>{line || ' '}</div>) : <span>No diff available for this file.</span>}</div></div>}
          </>}</div>
          <div className="changes-footer"><button className="commit-action" onClick={() => setDialog('commit')} disabled={!git.isRepository || selectedFiles.length === 0}><GitCommitHorizontal size={17} />Commit changes{selectedFiles.length > 0 ? ` (${selectedFiles.length})` : ''}</button><div className="secondary-actions"><button onClick={() => setDialog('push')} disabled={!git.isRepository || !git.pushTarget} title={git.pushTarget ? `Push to ${git.pushTarget}` : 'Configure an upstream branch to push'}><ArrowUp size={15} />Push</button><button onClick={() => setDialog('pr')} disabled={!git.isRepository} title="Create pull request"><GitPullRequest size={15} />Create PR</button></div></div>
        </aside>
      </div>
    </> }</main>

    {dialog && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(null); }}><div className="dialog" role="dialog" aria-modal="true"><div className="dialog-head"><div className="dialog-icon">{dialog === 'commit' ? <GitCommitHorizontal size={21} /> : dialog === 'push' ? <ArrowUp size={21} /> : dialog === 'pr' ? <GitPullRequest size={21} /> : dialog === 'removeProject' ? <Folder size={21} /> : <Trash2 size={21} />}</div><button className="icon-button" onClick={() => setDialog(null)} aria-label="Close"><X size={18} /></button></div><h2>{dialog === 'commit' ? 'Commit changes' : dialog === 'push' ? 'Push branch' : dialog === 'pr' ? 'Create pull request' : dialog === 'removeProject' ? 'Remove project' : 'Delete thread'}</h2>
      {dialog === 'commit' && <><p>Commit {selectedFiles.length} selected {selectedFiles.length === 1 ? 'file' : 'files'} on <strong>{git.branch}</strong>.</p><div className="dialog-file-list">{selectedFiles.map(file => <div key={file}><File size={14} />{file}</div>)}</div><label className="field-label" htmlFor="commit-message">Commit message</label><input id="commit-message" autoFocus value={commitMessage} onChange={event => setCommitMessage(event.target.value)} placeholder="Describe your changes" onKeyDown={event => { if (event.key === 'Enter' && commitMessage.trim()) performAction(); }} /></>}
      {dialog === 'push' && <p>Push <strong>{git.branch}</strong> to <strong>{git.pushTarget || 'an upstream branch'}</strong>. {git.ahead > 0 ? `${git.ahead} commit${git.ahead === 1 ? '' : 's'} ahead.` : ''}</p>}
      {dialog === 'pr' && <><p>Open a pull request for <strong>{git.branch}</strong>. {!git.pushTarget ? 'Configure an upstream branch first.' : git.ahead > 0 ? `Push ${git.ahead} local commit${git.ahead === 1 ? '' : 's'} before creating the pull request.` : `Branch is pushed to ${git.pushTarget}.`}</p><label className="field-label" htmlFor="pr-title">Title</label><input id="pr-title" autoFocus value={prTitle} onChange={event => setPrTitle(event.target.value)} placeholder="What does this change?" /><label className="field-label" htmlFor="pr-body">Description</label><textarea id="pr-body" value={prBody} onChange={event => setPrBody(event.target.value)} placeholder="Add context for reviewers…" rows={5} /><label className="draft-toggle"><input type="checkbox" checked={prDraft} onChange={event => setPrDraft(event.target.checked)} /><span>Open as draft</span></label></>}
      {dialog === 'delete' && <p>Delete <strong>{activeThread?.title || 'this thread'}</strong>? The conversation will be removed from this workspace.</p>}
      {dialog === 'removeProject' && <p>Remove <strong>{projectToRemove?.name}</strong> from Vulp? Its conversations will be removed from the app. The folder and files stay on disk.</p>}

      <div className="dialog-actions"><button className="ghost-button" onClick={() => setDialog(null)}>Cancel</button><button className={`primary-button ${dialog === 'delete' || dialog === 'removeProject' ? 'danger-button' : ''}`} onClick={performAction} disabled={busy || (dialog === 'commit' && (!commitMessage.trim() || selectedFiles.length === 0)) || (dialog === 'push' && !git.pushTarget) || (dialog === 'pr' && (!prTitle.trim() || !git.pushTarget || git.ahead > 0))}>{busy ? <LoaderCircle size={16} className="spin" /> : dialog === 'commit' ? <GitCommitHorizontal size={16} /> : dialog === 'push' ? <ArrowUp size={16} /> : dialog === 'pr' ? <GitPullRequest size={16} /> : dialog === 'removeProject' ? <Folder size={16} /> : <Trash2 size={16} />}{dialog === 'commit' ? 'Commit' : dialog === 'push' ? 'Push branch' : dialog === 'pr' ? 'Create PR' : dialog === 'removeProject' ? 'Remove project' : 'Delete thread'}</button></div></div></div>}
    {toast && <div className={`toast toast-${toast.kind}`}>{toast.kind === 'success' ? <CircleCheck size={17} /> : <CircleAlert size={17} />}{toast.text}<button onClick={() => setToast(null)} aria-label="Dismiss"><X size={14} /></button></div>}
  </div>;
}
