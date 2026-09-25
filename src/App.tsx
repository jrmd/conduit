import { QuestionCard } from './QuestionCard';
import { PlanCard } from './PlanCard';
import './planning.css';
import type { QuestionRequest } from '../shared/api';
import { ThreadPreview } from './ThreadPreview';
import { ModelControls } from './ModelControls';
import './model-controls.css';
import { modelFamilies, familyForModel } from '../shared/model-options';
import type { ModelSettings } from '../shared/api';
import { WorkspacePicker } from './WorkspacePicker';
import type { WorkspaceChoice } from '../shared/api';
import { useProjectBranches } from './useProjectBranches';
import { approvalMode, approvalModes } from '../shared/approval';
import { useComposerAutocomplete } from './ComposerAutocomplete';
import { ThreadPR } from './ThreadPR';
import { readSummaryChoice, type SummaryChoice } from './SummarySettings';
import { SettingsScreen } from './SettingsScreen';
import { providerIcons, providerNames } from './providers';
import { GitActions } from './GitActions';
import { CommitDialog } from './CommitDialog';
import { useAppearance } from './appearance';
import { JrmdShader } from './JrmdShader.webgl';
import { ProjectPicker } from './ProjectPicker';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardList, Hammer, ShieldCheck, ShieldOff, FileCheck2,
  Pin, PinOff, Archive, Copy, Paperclip, Download, Sparkles, Zap, ArrowUp, Check, ChevronDown, ChevronRight, CircleAlert,
  CircleCheck, File, FileCode2, FileDiff, Folder,
  GitBranch, GitCommitHorizontal, GitPullRequest, LoaderCircle, Menu,
  Plus, RefreshCw, Search, Settings2, Square, SquarePen, PanelLeftClose, PanelLeftOpen, FolderPlus, Star, Terminal, Trash2, X,
} from 'lucide-react';
import { ActivityFeed } from './ActivityFeed';
import { MessageMarkdown } from './MessageMarkdown';
import type { Thread, ComposerItem, Attachment, UpdateStatus, ChangedFile, GitStatus, ModelCatalogue, Project, ProviderId, Snapshot, ApprovalRequest, ApprovalMode } from '../shared/api';

type Dialog = 'commit' | 'push' | 'pr' | 'delete' | 'removeProject' | null;
type Toast = { text: string; kind: 'success' | 'error' } | null;

const approvalModeIcons = { supervised: ShieldCheck, 'auto-edits': FileCheck2, auto: Sparkles, 'full-access': ShieldOff };

function ApprovalModeIcon({ mode, size = 14 }: { mode: ApprovalMode; size?: number }) {
  const Icon = approvalModeIcons[mode];
  return <Icon size={size} aria-hidden="true" />;
}

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
  const [threadSearch, setThreadSearch] = useState('');
  const [showSettled, setShowSettled] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('conduit.sidebar-collapsed') === 'true'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('conduit.sidebar-collapsed', String(sidebarCollapsed)); } catch { /* Keep the preference for this session. */ }
  }, [sidebarCollapsed]);
  const [summaryChoice, setSummaryChoice] = useState<SummaryChoice | null>(readSummaryChoice);
  const [summaryBusy, setSummaryBusy] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>({ projects: [], threads: [], providers: [], disabledProviders: [] });
  const projectBranches = useProjectBranches(snapshot.projects);
  const [attachmentDrafts,setAttachmentDrafts] = useState<Record<string,Attachment[]>>({});
  const [attaching,setAttaching] = useState(false);
  const [copiedId,setCopiedId] = useState<string|null>(null);
  const [updateStatus,setUpdateStatus] = useState<UpdateStatus>({state:'idle'});
  const [contextMenu, setContextMenu] = useState<{x:number;y:number;projectId:string;threadId?:string}|null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('appearance');
  const [appInfo, setAppInfo] = useState({ version: '', platform: '' });
  useEffect(() => { window.j2code.getAppInfo().then(setAppInfo).catch(console.error); }, []);
  const [loading, setLoading] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('codex');
  const [selectedEffort, setSelectedEffort] = useState('');
  const [selectedModelSettings, setSelectedModelSettings] = useState<ModelSettings>({});
  const [hiddenModels, setHiddenModels] = useState<string[]>(() => { try { const saved = JSON.parse(localStorage.getItem('conduit.hidden-models') || '[]'); return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } });
  function toggleModelVisibility(key: string) {
    const next = hiddenModels.includes(key) ? hiddenModels.filter(item => item !== key) : [...hiddenModels, key];
    setHiddenModels(next);
    try { localStorage.setItem('conduit.hidden-models', JSON.stringify(next)); } catch { notify('Could not save model visibility; it will last for this session.', 'error'); }
  }
  const [effortOpen, setEffortOpen] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [questions, setQuestions] = useState<QuestionRequest[]>([]);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [answeringApproval, setAnsweringApproval] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<ApprovalMode>('supervised');
  const [selectedModels, setSelectedModels] = useState<Partial<Record<ProviderId, string>>>({});
  const [modelCatalogues, setModelCatalogues] = useState<Partial<Record<ProviderId, ModelCatalogue>>>({});
  const [modelOpen, setModelOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState<ProviderId | 'favourites'>('codex');
  const [modelQuery, setModelQuery] = useState('');
  const [favouriteModels, setFavouriteModels] = useState<string[]>(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem('conduit.favourite-models') || '[]'); return Array.isArray(saved) ? saved.filter((value): value is string => typeof value === 'string') : []; } catch { return []; }
  });
  const isFavouriteModel = (provider: ProviderId, model: string) => favouriteModels.includes(`${provider}:${model}`);
  function toggleFavouriteModel(provider: ProviderId, model: string) {
    const key = `${provider}:${model}`;
    const next = favouriteModels.includes(key) ? favouriteModels.filter(item => item !== key) : [...favouriteModels, key];
    setFavouriteModels(next);
    try { localStorage.setItem('conduit.favourite-models', JSON.stringify(next)); } catch { notify('Could not save favourites; they will last for this session.', 'error'); }
  }

  const [modelBusy, setModelBusy] = useState(false);
  const [modelOptionsSaving, setModelOptionsSaving] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [reviewTab, setReviewTab] = useState<'files' | 'activity'>('files');
  useEffect(() => { setReviewTab('files'); }, [activeProjectId, activeThreadId]);
  const [references, setReferences] = useState<Record<string, { provider: ProviderId; items: ComposerItem[] }>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [workspaceDrafts, setWorkspaceDrafts] = useState<Record<string, WorkspaceChoice>>({});
  const workspaceChoice = workspaceDrafts[activeProjectId || ''] || { mode: 'local' as const };
  const [sending, setSending] = useState(false);
  const [git, setGit] = useState<GitStatus>(initialGit);
  const [gitLoading, setGitLoading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [projectToRemove, setProjectToRemove] = useState<Project | null>(null);
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [prBase, setPrBase] = useState<string>();
  const [prTemplate, setPrTemplate] = useState<string>();
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
  const activeThreadRef = useRef<string | null>(null);
  activeThreadRef.current = activeThreadId;
  const activeProjectRef = useRef<string | null>(null);

  const activeProject = useMemo(() => snapshot.projects.find(p => p.id === activeProjectId) || null, [snapshot.projects, activeProjectId]);
  const activeThread = useMemo(() => snapshot.threads.find(t => t.id === activeThreadId) || null, [snapshot.threads, activeThreadId]);
  const providerLocked = !!activeThread && (activeThread.messages.some(message => message.role === 'user') || !!activeThread.sessionId || !!activeThread.running);
  const activeEffort = activeThread ? activeThread.effort || '' : selectedEffort;
  const activeProvider = activeThread?.provider || selectedProvider;
  const ProviderIcon = providerIcons[activeProvider];
  const activeModel = activeThread ? activeThread.model || '' : selectedModels[activeProvider] || '';
  const modelCatalogue = modelCatalogues[activeProvider];
  const activeFamily = familyForModel(modelFamilies(activeProvider, modelCatalogue?.options || []), activeModel);
  const displayedEffort = activeProvider === 'cursor' ? activeFamily?.variants.find(item => item.id === activeModel)?.effort || '' : activeEffort;
  const activeModelSettings = activeThread || selectedModelSettings;
  const effortChoices = modelCatalogue?.options.find(option => option.id === activeModel)?.efforts || [];
  const enabledProviders = snapshot.providers.filter(provider => !snapshot.disabledProviders.includes(provider.id));
  const pickerProviders = enabledProviders.filter(provider => provider.available && (!providerLocked || provider.id === activeThread?.provider) && (modelFilter === 'favourites' || provider.id === modelFilter));
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
  const referenceDraft = references[draftKey];
  const selectedReferences = referenceDraft?.provider === activeProvider ? referenceDraft.items.filter(item => draft.includes(item.token)) : [];
  const autocomplete = useComposerAutocomplete({ value: draft, projectId: activeProjectId || undefined, threadId: activeThreadId || undefined, provider: activeProvider, input: inputRef, onChange: setDraft, onChoose: item => setReferences(previous => ({ ...previous, [draftKey]: { provider: activeProvider, items: [...selectedReferences.filter(existing => existing.id !== item.id), item] } })) });
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
    if (!modelOpen && !(settingsOpen && settingsTab === 'providers')) return;
    let mounted = true;
    for (const provider of snapshot.providers) {
      if (!provider.available || modelCatalogues[provider.id]) continue;
      window.j2code.getModels(provider.id).then(catalogue => {
        if (mounted) setModelCatalogues(previous => ({ ...previous, [provider.id]: catalogue }));
      }).catch(error => {
        if (mounted) setModelCatalogues(previous => ({ ...previous, [provider.id]: { provider: provider.id, options: [], warning: String(error) } }));
      });
    }
    return () => { mounted = false; };
  }, [modelOpen, settingsOpen, settingsTab, snapshot.providers, snapshot.disabledProviders]);

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
      const result = await window.j2code.getGit(projectId, activeThreadRef.current || undefined);
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
      if (event.type === 'run-finished') {
        setStreamByThread(previous => ({ ...previous, [event.threadId]: '' }));
        setActivityByThread(previous => ({ ...previous, [event.threadId]: '' }));
      }
      if (event.type === 'questions') setQuestions(event.questions);
      if (event.type === 'approvals') setApprovals(event.approvals);
      if (event.type === 'snapshot') {
        setApprovals(event.snapshot.approvals || []);
        setQuestions(event.snapshot.questions || []);
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
      setApprovals(data.approvals || []);
      setQuestions(data.questions || []);
      const firstProject = data.projects[0];
      if (firstProject) {
        setActiveProjectId(firstProject.id);
        const firstThread = data.threads.filter(t => t.projectId === firstProject.id && !t.settled).sort((a, b) => b.updatedAt - a.updatedAt)[0];
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
  }, [activeProjectId, activeThreadId, refreshGit]);

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
      if (!(event.target instanceof Element) || !event.target.closest('.model-wrap, .effort-wrap, .approval-mode-wrap')) {
        setModelOpen(false); setEffortOpen(false); setApprovalOpen(false);
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') { setModelOpen(false); setEffortOpen(false); setApprovalOpen(false); }
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, []);

  useEffect(() => { setModelOpen(false); setEffortOpen(false); setApprovalOpen(false); }, [activeThreadId, activeProjectId]);

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
        setSidebarOpen(false);
      }
    } catch (error) { notify(String(error), 'error'); }
  }

  async function send() {
    const text = draft.trim() || (draftAttachments.length ? 'Please review the attached files.' : '');
    if (!text || !activeProjectId || sending || !providerInstalled) return;
    setSending(true);
    if (activeThreadId && !activeThread?.running) setActivityByThread(previous => ({ ...previous, [activeThreadId]: '' }));
    let threadId = activeThreadId;
    try {
      if (!threadId) {
        let thread = await window.j2code.createThread(activeProjectId, selectedProvider, selectedMode, selectedModels[selectedProvider] || undefined, selectedEffort || undefined, workspaceChoice);
        if (planning || selectedModelSettings.contextWindow !== undefined || selectedModelSettings.fastMode !== undefined) thread = await window.j2code.updateThreadConfig(thread.id, {provider: thread.provider, mode: thread.mode, model: thread.model, effort: thread.effort, planning, ...selectedModelSettings});
        setWorkspaceDrafts(previous => ({ ...previous, [activeProjectId]: { mode: 'local' } }));
        setSnapshot(previous => ({ ...previous, threads: [thread, ...previous.threads.filter(existing => existing.id !== thread.id)] }));
        setActiveThreadId(thread.id);
        threadId = thread.id;
      }
      await window.j2code.send(threadId, text, draftAttachments.map(file=>file.id), { delivery: 'queue', title: summaryChoice || undefined, references: selectedReferences.map(item => item.id) });
      setReferences(previous => ({ ...previous, [draftKey]: { provider: activeProvider, items: [] } }));
      setAttachmentDrafts(previous=>({...previous,[draftKey]:[],[threadId!]:[]}));
      const acceptedThreadId = threadId;
      setDrafts(previous => ({ ...previous, [draftKey]: '', [acceptedThreadId]: '' }));
    } catch (error) {
      if (threadId) { const failedThreadId = threadId; setReferences(previous => ({ ...previous, [failedThreadId]: { provider: activeProvider, items: selectedReferences } })); setAttachmentDrafts(previous=>({...previous,[failedThreadId]:draftAttachments})); setDrafts(previous => ({ ...previous, [failedThreadId]: text })); }
      notify(String(error), 'error');
    } finally { setSending(false); }
  }

  async function attachFiles(files?: File[]) {
    if (attaching || sending) return;
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
    try { const result = await window.j2code.getDiff(projectId, file, activeThreadId || undefined); if (request === diffRequestRef.current && projectId === activeProjectRef.current) setDiff(result); }
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
        notify('Project removed from Conduit');
        return;
      }
      if (!projectId) return;
      if (dialog === 'push') { if (!git.pushTarget) return; await window.j2code.push(projectId, activeThreadId || undefined); notify('Changes pushed'); }
      if (dialog === 'pr') {
        if (!git.pushTarget || git.ahead > 0) return;
        const url = await window.j2code.createPR({ projectId, threadId: activeThreadId || undefined, title: prTitle.trim(), body: prBody.trim(), base: prBase, draft: prDraft });
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
    const thread = snapshot.threads.filter(t => t.projectId === project.id && (!t.settled || !!threadSearch.trim()) && [t.title,t.summary,t.branch,...(t.branches || []),...t.messages.map(m => m.text)].join(' ').toLowerCase().includes(threadSearch.trim().toLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt)[0];
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
        setSelectedModelSettings({});
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
  useEffect(() => {
    if (!approvalOpen) return;
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element).closest('.approval-mode-wrap')) setApprovalOpen(false); };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [approvalOpen]);
  useEffect(() => { setApprovalOpen(false); }, [activeThreadId, activeProjectId]);
  const changedCount = git.files.length;
  // Commit messages use the title model when one is chosen, otherwise this thread's agent.
  const commitWriter = (() => {
    const choice = summaryChoice || { provider: activeProvider, model: activeThread?.model || selectedModels[activeProvider] };
    const usable = snapshot.providers.some(provider => provider.id === choice.provider && provider.available) && !snapshot.disabledProviders.includes(choice.provider);
    return usable ? { provider: choice.provider, model: choice.model || undefined, label: providerNames[choice.provider] } : null;
  })();
  const canSend = (!!draft.trim() || !!draftAttachments.length) && !attaching && !!activeProject && !!providerInstalled && providerEnabled && !modelBusy && !sending;

  async function summarize(id: string) {
    setContextMenu(null);
    const thread = snapshot.threads.find(t => t.id === id); if (!thread) return;
    const choice = summaryChoice || { provider: thread.provider, model: thread.model };
    setSummaryBusy(id);
    try { await window.j2code.summarizeThread(id, choice.provider, choice.model || undefined); notify('Thread title updated'); }
    catch (error) { notify(String(error), 'error'); }
    finally { setSummaryBusy(null); }
  }
  async function settle(id: string) {
    setContextMenu(null);
    try { await window.j2code.settleThread(id, !snapshot.threads.find(t => t.id === id)?.settled); }
    catch (error) { notify(String(error), 'error'); }
  }
  async function pin(id: string) {
    setContextMenu(null);
    try { await window.j2code.pinThread(id, !snapshot.threads.find(t => t.id === id)?.pinned); }
    catch (error) { notify(String(error), 'error'); }
  }
  const sidebarQuery = threadSearch.trim().toLowerCase();
  const matchingThreads = snapshot.threads.filter(thread => {
    const project = snapshot.projects.find(project => project.id === thread.projectId);
    return project && [project.name, thread.title, thread.summary, thread.branch, ...(thread.branches || []), ...thread.messages.map(message => message.text)].join(' ').toLowerCase().includes(sidebarQuery);
  }).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
  const renderSessions = (threads: Thread[], empty: string) => threads.length ? threads.map(thread => {
            const project = snapshot.projects.find(project => project.id === thread.projectId)!;
            const ProviderIcon = providerIcons[thread.provider];
            const needsQuestion = questions.some(request => request.threadId === thread.id);
            const needsApproval = approvals.some(request => request.threadId === thread.id) || needsQuestion;
            const branch = thread.workspace?.mode === 'worktree' ? thread.branch : projectBranches[project.id];
            const hue = [...project.name].reduce((value, letter) => (value * 31 + letter.charCodeAt(0)) % 360, 0);
            return <ThreadPreview title={thread.title || 'New thread'} project={project.name} branch={branch} model={modelCatalogues[thread.provider]?.options.find(option => option.id === thread.model)?.label || thread.model || `${providerNames[thread.provider]} · Default`} icon={<ProviderIcon width={14} height={14}/>} className={`sidebar-thread session-card ${needsApproval || thread.running ? 'has-status' : ''} ${thread.settled ? 'settled-card' : ''}`} key={thread.id}>
              <button className={`thread-item ${thread.id === activeThreadId ? 'active' : ''}`} aria-current={thread.id === activeThreadId ? 'page' : undefined} onContextMenu={event => { event.preventDefault(); setContextMenu({x:event.clientX,y:event.clientY,projectId:project.id,threadId:thread.id}); }} onClick={() => { setSettingsOpen(false); setActiveProjectId(project.id); setActiveThreadId(thread.id); setSidebarOpen(false); }}>
                {!thread.settled && <span className="session-project-row"><span className="session-project-dot" style={{background:`hsl(${hue} 65% 58%)`}}/><span className="session-project-name" title={project.name}>{project.name}</span></span>}
                <span className="session-title-row"><span className="thread-item-title" title={thread.title}>{thread.title || 'New thread'}</span>
                  {thread.settled ? <time className="settled-age" title={new Date(thread.updatedAt).toLocaleString()}>{timeAgo(thread.updatedAt)}</time> : <span className={`session-status ${needsApproval ? 'needs-approval' : thread.running ? 'working' : ''}`}>{needsApproval ? <><CircleAlert size={12}/>{needsQuestion ? 'Question' : 'Approval'}</> : thread.running ? <><span className="working-dot"/>Working</> : <time>{timeAgo(thread.updatedAt)}</time>}</span>}
                </span>
                {!thread.settled && <span className="session-meta">{branch && <span className="session-branch" title={branch}><GitBranch size={11}/>{branch}</span>}{thread.pinned && <Pin size={11} className="session-pinned" aria-label="Pinned"/>}<span className="session-provider" title={providerNames[thread.provider]}><ProviderIcon width={13} height={13}/></span></span>}
              </button>
              <div className="session-actions">
                <button className="session-pin" aria-label={`${thread.pinned ? 'Unpin' : 'Pin'} ${thread.title}`} title={thread.pinned ? 'Unpin thread' : 'Pin thread'} aria-pressed={!!thread.pinned} onClick={() => pin(thread.id)}>{thread.pinned ? <PinOff size={13}/> : <Pin size={13}/>}</button>
                <button className="session-settle" aria-label={`${thread.settled ? 'Restore' : 'Settle'} ${thread.title}`} disabled={!!thread.running} onClick={() => settle(thread.id)}>{thread.settled ? <RefreshCw size={13}/> : <Check size={13}/>}<span>{thread.settled ? 'Restore' : 'Settle'}</span></button>
              </div>
            </ThreadPreview>;
          }) : <div className="sidebar-empty">{empty}</div>;
  const ThreadIcon = providerIcons[activeThread?.provider || activeProvider];
  const reopenSidebar = sidebarCollapsed && <button className="icon-button sidebar-reopen" aria-label="Expand sidebar" title="Expand sidebar" onClick={() => setSidebarCollapsed(false)}><PanelLeftOpen size={17}/></button>;
  return <div className={`app-shell quiet-focus platform-${appInfo.platform} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    {contextMenu && <div className="workspace-context-menu" role="menu" aria-label="Workspace actions" style={{left:Math.min(contextMenu.x,window.innerWidth-210),top:Math.min(contextMenu.y,window.innerHeight-220)}}>
      <button autoFocus role="menuitem" onClick={() => { const project=snapshot.projects.find(p=>p.id===contextMenu.projectId);if(project){selectProject(project);setActiveThreadId(null);} }}><Plus size={14}/>New thread here</button>
      {contextMenu.threadId && <><button role="menuitem" onClick={() => pin(contextMenu.threadId!)}><Pin size={14}/>{snapshot.threads.find(t => t.id === contextMenu.threadId)?.pinned ? 'Unpin thread' : 'Pin thread'}</button><button role="menuitem" disabled={!!snapshot.threads.find(t => t.id === contextMenu.threadId)?.running} onClick={() => settle(contextMenu.threadId!)}><Archive size={14}/>{snapshot.threads.find(t => t.id === contextMenu.threadId)?.settled ? 'Restore thread' : 'Settle thread'}</button><button role="menuitem" disabled={summaryBusy === contextMenu.threadId || !!snapshot.threads.find(t => t.id === contextMenu.threadId)?.running} onClick={() => summarize(contextMenu.threadId!)}><Sparkles size={14}/>Regenerate title</button></>}
      {contextMenu.threadId ? <button className="danger" role="menuitem" onClick={() => {setActiveProjectId(contextMenu.projectId);setActiveThreadId(contextMenu.threadId!);setDialog('delete');}}><Trash2 size={14}/>Delete thread…</button> : <button className="danger" role="menuitem" onClick={() => {setProjectToRemove(snapshot.projects.find(p=>p.id===contextMenu.projectId)!);setDialog('removeProject');}}><X size={14}/>Remove project…</button>}
    </div>}
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-top">
        <div className="brand" title="Conduit"><img className="conduit-brand-logo" src="./conduit-mark.svg" alt="" /><span>Conduit</span></div>
        <button className="icon-button sidebar-collapse" aria-label="Collapse sidebar" title="Collapse sidebar" onClick={() => setSidebarCollapsed(true)}><PanelLeftClose size={17}/></button>
        <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar"><X size={17} /></button>
      </div>
      <div className="sidebar-tools">
        <label className="thread-search"><Search size={16}/><input aria-label="Search threads" placeholder="Search" value={threadSearch} onChange={e => setThreadSearch(e.target.value)}/>{threadSearch && <button aria-label="Clear thread search" onClick={() => setThreadSearch('')}><X size={12}/></button>}</label>
        <button className="icon-button" aria-label="Show projects" title="Projects" aria-expanded={projectsOpen} onClick={() => setProjectsOpen(!projectsOpen)}><Folder size={16}/></button>
        <button className="icon-button" onClick={pickProject} title="Open project folder" aria-label="Open project folder"><FolderPlus size={16}/></button>
        <button className="icon-button" disabled={!activeProject} aria-label="New thread" title={appInfo.platform === 'darwin' ? 'New thread (⌘ N)' : 'New thread (Ctrl N)'} onClick={() => { setSettingsOpen(false); setActiveThreadId(null); setSidebarOpen(false); requestAnimationFrame(() => inputRef.current?.focus()); }}><SquarePen size={16}/></button>
      </div>
      {projectsOpen && <div className="sidebar-projects" aria-label="Projects">
        {snapshot.projects.map(project => <div className="project-row" key={project.id} onContextMenu={event => { event.preventDefault(); setContextMenu({x:event.clientX,y:event.clientY,projectId:project.id}); }}>
          <button className="project-title" onClick={() => selectProject(project)} title={project.path}><Folder size={14}/><span>{project.name}</span></button>
          <button className="project-row-action" aria-label={`New thread in ${project.name}`} onClick={() => { selectProject(project); setActiveThreadId(null); setSettingsOpen(false); setSidebarOpen(false); }}><Plus size={14}/></button>
          <button className="project-row-action" aria-label={`Remove ${project.name}`} onClick={() => { setProjectToRemove(project); setDialog('removeProject'); }}><X size={13}/></button>
        </div>)}
        {!snapshot.projects.length && <div className="sidebar-empty">Open a local folder to start.</div>}
      </div>}
      <div className="sidebar-content session-list">
        {renderSessions(matchingThreads.filter(thread => (sidebarQuery && !showSettled) || !thread.settled), sidebarQuery ? 'No matching threads.' : snapshot.projects.length ? 'Your next idea starts a new thread.' : 'Open a local folder to start.')}
      </div>
      <button className="settled-toggle" aria-expanded={showSettled} aria-controls="settled-threads" onClick={() => setShowSettled(!showSettled)}><span>Settled <span className="settled-count">({snapshot.threads.filter(thread => thread.settled).length})</span></span><span className="settled-rule"/><ChevronDown size={13} className={showSettled ? 'settled-expanded' : ''}/></button>
      {showSettled && <div className="settled-list" id="settled-threads" role="region" aria-label="Settled threads">
        {renderSessions(matchingThreads.filter(thread => thread.settled), sidebarQuery ? 'No matching settled threads.' : 'No settled threads.')}
      </div>}

      <div className="sidebar-footer"><span className="app-version" title="Installed version">v{appInfo.version || '…'}</span>{updateStatus.state==='ready' ? <button className="update-ready" title="Restart to update" aria-label="Restart to update" onClick={()=>window.j2code.installUpdate().catch(error=>notify(String(error),'error'))}><Download size={13}/></button> : null}<button className={`footer-settings ${settingsOpen ? 'active' : ''}`} title="Agent settings" aria-label="Agent settings" onClick={() => setSettingsOpen(true)}><Settings2 size={15} /><span>Settings</span></button></div>
    </aside>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}

    <main className="main-area">
      {settingsOpen ? <>
        <SettingsScreen leading={reopenSidebar} version={appInfo.version} tab={settingsTab} onTab={setSettingsTab} onClose={() => setSettingsOpen(false)} appearance={appearance} onAppearance={setAppearance} updateStatus={updateStatus} onUpdateStatus={setUpdateStatus} snapshot={snapshot} onSnapshot={setSnapshot} summaryChoice={summaryChoice} onSummaryChoice={choice => { setSummaryChoice(choice); localStorage.setItem('conduit.summary-model', JSON.stringify(choice)); }} modelCatalogues={modelCatalogues} hiddenModels={hiddenModels} onToggleModel={toggleModelVisibility} notify={notify}/>
      </> : <>

      <header className="topbar">
        <div className="topbar-left">{reopenSidebar}<button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar"><Menu size={18} /></button>{activeThread && activeThread.messages.length > 0 && <>{!providerLocked ? <ProjectPicker projects={snapshot.projects} current={activeProject} onSelect={project=>{selectProject(project);setActiveThreadId(null)}} onOpen={pickProject}/> : <span className="breadcrumb-project">{activeProject?.name || 'Workspace'}</span>}<ChevronRight size={14} className="breadcrumb-separator" /><strong>{activeThread?.title || 'New thread'}</strong></>}</div>
        <div className="topbar-actions">
          {activeThread && activeThread.messages.length > 0 && <ThreadPR key={activeThread.id} thread={activeThread}/>}
          {activeThread && activeThread.messages.length > 0 && <button className={`icon-button changes-toggle ${changesOpen ? 'is-on' : ''}`} title="Toggle changes" aria-label="Toggle changes" aria-expanded={changesOpen} onClick={() => setChangesOpen(!changesOpen)}><FileDiff size={16} /><span>Changes</span>{changedCount > 0 && <span className="count-dot">{changedCount}</span>}</button>}
        </div>
      </header>

      <div className="work-area">
        <section className="conversation">
          {loading ? <div className="center-state"><LoaderCircle className="spin" size={24} /><p>Opening workspace…</p></div>
            : !activeProject ? <div className="welcome-state"><JrmdShader theme={theme}/><img className="conduit-hero-logo" src="./conduit-mark.svg" alt="Conduit logo" /><h1>Open a project</h1><p>Choose a local folder to start working with a coding agent.</p><button className="primary-button" onClick={pickProject}><Plus size={15} /> Open folder</button></div>
            : activeThread && activeThread.messages.length > 0 ? <div className="messages-scroll" ref={messagesScrollRef} onScroll={event => { const el = event.currentTarget; nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; }}><div className="messages-inner">
              {activeThread.messages.map((message, index) => <Fragment key={message.id}><div className={`message message-${message.role}`}>
                <div className={`message-avatar ${message.role === 'assistant' ? 'agent-avatar' : ''}`}>{message.role === 'user' ? 'You' : message.role === 'assistant' ? providerNames[activeThread.provider] : <Terminal size={15} />}</div>
                <div className="message-body"><div className="message-heading"><strong>{message.role === 'assistant' && <span className="message-agent-icon" aria-hidden="true"><ThreadIcon width={12} height={12}/></span>}{message.role === 'user' ? 'You' : message.role === 'assistant' ? providerNames[activeThread.provider] : 'Agent stopped'}</strong><time>{timeAgo(message.createdAt)}</time></div><div className="message-text"><MessageMarkdown text={message.text}/></div>{message.attachments?.length ? <div className="message-attachments">{message.attachments.map(file=><span className="attachment-chip" key={file.id}>{file.preview ? <img src={file.preview} alt={file.name}/> : <File size={16}/>}<span>{file.name}</span></span>)}</div> : null}{message.role==='assistant' && <button className="copy-response" aria-label="Copy response" onClick={async()=>{try{await window.j2code.copyText(message.text);setCopiedId(message.id);setTimeout(()=>setCopiedId(null),1800)}catch(error){notify(String(error),'error')}}}>{copiedId===message.id?<Check size={13}/>:<Copy size={13}/>}<span>{copiedId===message.id?'Copied':'Copy'}</span></button>}</div>
              </div>
              {message.role === 'user' && <ActivityFeed waitingForQuestion={questions.some(request=>request.threadId===activeThread.id)} waiting={approvals.some(request=>request.threadId===activeThread.id)} items={(activeThread.activity || []).filter(item => item.createdAt >= message.createdAt && item.createdAt < (activeThread.messages.slice(index + 1).find(next => next.role === 'user')?.createdAt ?? Infinity))} running={activeThread.running && !activeThread.messages.slice(index + 1).some(next => next.role === 'user')} />}
              </Fragment>)}
              {activeStream && <div className="message message-assistant streaming-message"><div className="message-avatar agent-avatar">{providerNames[activeThread.provider]}</div><div className="message-body"><div className="message-heading"><strong><span className="message-agent-icon" aria-hidden="true"><ThreadIcon width={12} height={12}/></span>{providerNames[activeThread.provider]}</strong><LoaderCircle className="spin" size={11} /></div><div className="message-text"><MessageMarkdown text={activeStream}/></div></div></div>}

            </div></div>
            : <div className="empty-conversation"><JrmdShader theme={theme}/><div className="new-thread-heading"><div className="new-thread-question" role="heading" aria-level={1}><span>What should we build in</span><ProjectPicker inline projects={snapshot.projects} current={activeProject} onSelect={project => { selectProject(project); setActiveThreadId(null); }} onOpen={pickProject}/><span className="question-mark">?</span></div></div></div>}

          {activeProject && <div className="composer-zone">
            {activeThread?.plan && <PlanCard key={activeThread.id} thread={activeThread} onError={error=>notify(error,'error')} onHandoff={thread=>{
              setSnapshot(previous=>({...previous,threads:[thread,...previous.threads.filter(t=>t.id!==thread.id)]}));
              setActiveThreadId(thread.id); setDrafts(previous=>({...previous,[thread.id]:'Implement the saved plan.'}));
            }}/>}
            {!!activeThread?.queuedMessages?.length && <section className="message-queue" aria-label="Queued messages">
              <div className="queue-heading"><strong>{activeThread.queuePaused ? 'Queue paused' : 'Queued'} · {activeThread.queuedMessages.length}</strong>{activeThread.queuePaused && !activeThread.running && <button onClick={() => window.j2code.resumeQueue(activeThread.id).catch(error => notify(String(error), 'error'))}>Resume queue</button>}</div>
              {activeThread.queuedMessages.map(message => <div className="queued-message" key={message.id}><span>{message.text}{message.attachments.length > 0 && <small> · {message.attachments.length} attachment(s)</small>}</span><button className="steer-button" aria-label={`Steer queued message: ${message.text}`} title="Interrupt the current run and send this queued message next" onClick={() => window.j2code.steerQueuedMessage(activeThread.id, message.id).catch(error => notify(String(error), 'error'))}>Steer now</button><button aria-label={`Remove queued message: ${message.text}`} onClick={() => window.j2code.removeQueuedMessage(activeThread.id, message.id).catch(error => notify(String(error), 'error'))}><X size={14}/></button></div>)}
            </section>}
            {draftAttachments.length>0 && <div className="draft-attachments">{draftAttachments.map(file=><span className="attachment-chip" key={file.id}>{file.preview?<img src={file.preview} alt={file.name}/>:<File size={16}/>}<span>{file.name}<small>{file.mime.startsWith('image/')?'Image': 'Local file'} · {Math.max(1,Math.round(file.size/1024))} KB</small></span><button aria-label={`Remove ${file.name}`} disabled={sending} onClick={()=>setAttachmentDrafts(previous=>({...previous,[draftKey]:draftAttachments.filter(item=>item.id!==file.id)}))}><X size={12}/></button></span>)}</div>}
              <div className="composer" data-model-options-saving={modelOptionsSaving} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();void attachFiles(Array.from(event.dataTransfer.files))}}>

              {autocomplete.menu}
              <div className="question-requests">{questions.filter(q=>q.threadId===activeThreadId).map(request=><QuestionCard key={request.id} request={request} onError={error=>notify(error,'error')}/>)}</div>
              <div className="approval-requests">{approvals.filter(request=>request.threadId === activeThreadId).map(request=><section className="approval-request" key={request.id} aria-label="Approval required"><strong>{request.title}</strong><pre>{request.detail}</pre><div>{[false,true].map(allow=><button key={String(allow)} disabled={answeringApproval === request.id} onClick={async()=>{setAnsweringApproval(request.id);try{await window.j2code.respondApproval(request.id,request.threadId,allow);}catch(error){notify(String(error),'error');}finally{setAnsweringApproval(null);}}}>{allow?'Allow once':'Deny'}</button>)}</div></section>)}</div>
              <textarea {...autocomplete.aria} onSelect={autocomplete.updateCaret} onBlur={autocomplete.dismiss} onPaste={event=>{const files=Array.from(event.clipboardData.files);if(files.length){event.preventDefault();void attachFiles(files)}}} ref={inputRef} placeholder={providerInstalled ? (activeThread?.running ? 'Queue a follow-up…' : 'Ask anything… @ files · / skills & plugins') : 'Install an agent CLI to start…'} value={draft} onChange={event => { setDraft(event.target.value); autocomplete.updateCaret(); }} onKeyDown={event => { if (autocomplete.onKeyDown(event)) return; if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} disabled={sending} rows={2} aria-label="Message" />
              <div className="composer-bottom">
                <button className="attach-button" aria-label="Attach files" title="Attach images or files" disabled={attaching || sending} onClick={()=>attachFiles()}>{attaching?<LoaderCircle size={15} className="spin"/>:<Paperclip size={15}/>}</button>
                <div className="model-wrap">
                  <button className="model-select" data-testid="model-selector" aria-label="Select model" aria-expanded={modelOpen} onClick={() => { setModelOpen(!modelOpen); setEffortOpen(false); setModelQuery(''); setModelFilter(activeProvider); if (window.innerWidth <= 900) setChangesOpen(false); }} disabled={!!activeThread?.running || modelBusy || (providerLocked && !providerEnabled)}><ProviderIcon style={{width:16,height:16}} /><span className="model-current" title={activeModel || 'CLI default'}>{activeFamily?.label || activeModel || `${providerNames[activeProvider]} · Default`}</span><ChevronDown size={13} /></button>
                  {modelOpen && <div className="model-menu model-browser" role="dialog" aria-label="Choose a model">
                    <div className="model-search"><Search size={15} /><input aria-label="Search models or enter exact model ID" autoFocus value={modelQuery} onChange={event => setModelQuery(event.target.value)} placeholder="Find a model…" /></div>
                    <div className="model-provider-filters" role="group" aria-label="Model filters">
                      <button aria-pressed={modelFilter === 'favourites'} title="Favourites" aria-label="Favourites" onClick={() => setModelFilter('favourites')}><Star /></button>
                      {enabledProviders.filter(provider => provider.available && (!providerLocked || provider.id === activeProvider)).map(provider => { const Icon = providerIcons[provider.id]; return <button aria-pressed={modelFilter === provider.id} key={provider.id} title={provider.name} aria-label={provider.name} onClick={() => setModelFilter(provider.id)}><Icon /></button>; })}
                    </div>
                    <div className="model-options">
                      {pickerProviders.map(provider => {
                        const catalogue = modelCatalogues[provider.id];
                        const allOptions = [{id: '', label: 'CLI default', variants: [{id: ''}]}, ...modelFamilies(provider.id, catalogue?.options || [])];
                        const options = allOptions.filter(option => !hiddenModels.includes(`${provider.id}:${option.id}`) && `${provider.name} ${option.label} ${option.id}`.toLowerCase().includes(modelQuery.trim().toLowerCase()) && (modelFilter !== 'favourites' || isFavouriteModel(provider.id, option.id)));
                        const Icon = providerIcons[provider.id];
                        return <section className="model-provider-group" key={provider.id}>
                          {options.map(option => {
                            const selected = activeProvider === provider.id && option.variants.some(variant => variant.id === activeModel);
                            const starred = isFavouriteModel(provider.id, option.id);
                            return <div className={`model-choice-row ${selected ? 'selected' : ''}`} key={option.id}>
                              <button className="model-choice" title={`${provider.name} · ${option.id || 'CLI default'}`} disabled={modelBusy} onClick={() => chooseModel(option.id, provider.id)}><Icon /><span><strong>{option.label}</strong>{modelFilter === 'favourites' && <small>{provider.name}</small>}</span>{selected && <Check size={14} />}</button>
                              <button className="model-favourite" title={`${starred ? 'Unfavourite' : 'Favourite'} ${option.label}`} aria-label={`${starred ? 'Unfavourite' : 'Favourite'} ${provider.name} ${option.label}`} aria-pressed={starred} onClick={() => toggleFavouriteModel(provider.id, option.id)}><Star size={13} fill={starred ? 'currentColor' : 'none'} /></button>
                            </div>;
                          })}
                          {modelFilter !== 'favourites' && modelQuery.trim() && !allOptions.some(option => option.id === modelQuery.trim()) && <button className="manual-model" disabled={modelBusy} onClick={() => chooseModel(modelQuery, provider.id)}><span><strong>Use exact ID: {modelQuery.trim()}</strong><small>With {provider.name}</small></span><Plus size={15} /></button>}
                          {!catalogue && <div className="model-note">Loading models…</div>}
                        </section>;
                      })}
                      {modelFilter === 'favourites' && !pickerProviders.some(provider => [{id:'',label:'CLI default'}, ...modelFamilies(provider.id, modelCatalogues[provider.id]?.options || [])].some(option => !hiddenModels.includes(`${provider.id}:${option.id}`) && isFavouriteModel(provider.id, option.id) && `${provider.name} ${option.label} ${option.id}`.toLowerCase().includes(modelQuery.trim().toLowerCase()))) && <div className="model-note">{modelQuery.trim() ? 'No matching favourites.' : 'Star models in a provider tab to keep them here.'}</div>}
                      {!pickerProviders.length && <div className="model-note">No enabled, installed providers. Enable a provider in Settings to choose its models.</div>}
                    </div>
                  </div>}
                </div>
                <div className="effort-wrap">
                  <button className={`effort-select effort-${activeEffort || 'auto'}`} aria-label="Reasoning effort" aria-expanded={effortOpen} title={effortChoices.length ? 'Reasoning effort' : 'This model does not advertise effort levels; using CLI default'} disabled={!!activeThread?.running || modelBusy || !providerEnabled} onClick={() => { setEffortOpen(!effortOpen); setModelOpen(false); }}><Zap size={14} /><span>{displayedEffort || 'Auto'}</span><span className="effort-meter" aria-hidden="true">{[0,1,2,3,4,5].map(index => <i key={index} className={index < Math.max(0,effortRanks.indexOf(activeEffort) - 1) ? 'lit' : ''} />)}</span></button>
                  {effortOpen && <div className="effort-menu" role="dialog" aria-label="Model options"><ModelControls provider={activeProvider} options={modelCatalogue?.options || []} model={activeModel} effort={activeEffort} settings={activeModelSettings} saving={modelOptionsSaving} disabled={modelBusy || sending || !!activeThread?.running} onChange={async (model, effort, settings) => {
                    setModelBusy(true);
                    setModelOptionsSaving(true);
                    try {
                      if (activeThread) {
                        const updated = await window.j2code.updateThreadConfig(activeThread.id, {provider: activeProvider, mode: activeThread.mode, model: model || undefined, effort: effort || undefined, contextWindow: settings.contextWindow, fastMode: settings.fastMode});
                        setSnapshot(previous => ({...previous, threads: previous.threads.map(thread => thread.id === updated.id ? updated : thread)}));
                      } else { setSelectedModels(previous => ({...previous, [activeProvider]: model})); setSelectedEffort(effort); setSelectedModelSettings(settings); }
                    } catch(error) { notify(String(error), 'error'); } finally { setModelBusy(false); setModelOptionsSaving(false); }
                  }}/></div>}
                </div>
                <button className="mode-select planning-toggle" aria-label="Plan mode" aria-pressed={activeThread?.planning ?? planning} disabled={!!activeThread?.running || sending || modelBusy} onClick={async()=>{
                  if(!activeThread) {setPlanning(!planning);return;}
                  setModelBusy(true);
                  try {const updated=await window.j2code.updateThreadConfig(activeThread.id,{...activeThread,planning:!activeThread.planning});setSnapshot(previous=>({...previous,threads:previous.threads.map(t=>t.id===updated.id?updated:t)}));}
                  catch(error){notify(String(error),'error');}finally{setModelBusy(false);}
                }}>{(activeThread?.planning ?? planning) ? <><ClipboardList size={14} aria-hidden="true" />Plan</> : <><Hammer size={14} aria-hidden="true" />Build</>}</button>
                <div className="approval-mode-wrap">
                  <button className="mode-select" aria-label="Approval mode" aria-expanded={approvalOpen} disabled={!!activeThread?.running || sending || modelBusy} onClick={() => { setApprovalOpen(!approvalOpen); setModelOpen(false); setEffortOpen(false); }}><ApprovalModeIcon mode={approvalMode(activeThread?.mode || selectedMode)} />{approvalModes.find(mode => mode.id === approvalMode(activeThread?.mode || selectedMode))?.label}<ChevronDown size={13}/></button>
                  {approvalOpen && <div className="approval-mode-menu" role="dialog" aria-label="Choose approval mode">{approvalModes.map(mode => <button key={mode.id} aria-pressed={approvalMode(activeThread?.mode || selectedMode) === mode.id} onClick={async () => {
                    setModelBusy(true);
                    try { if(activeThread) { const updated = await window.j2code.updateThreadConfig(activeThread.id,{provider:activeProvider,model:activeModel || undefined,effort:activeEffort || undefined,contextWindow:activeModelSettings.contextWindow,fastMode:activeModelSettings.fastMode,mode:mode.id}); setSnapshot(previous=>({...previous,threads:previous.threads.map(thread=>thread.id===updated.id?updated:thread)})); } else setSelectedMode(mode.id); setApprovalOpen(false); } catch(error) { notify(String(error),'error'); } finally { setModelBusy(false); }
                  }} disabled={modelBusy}><ApprovalModeIcon mode={mode.id} size={16} /><span><strong>{mode.label}</strong><small>{mode.description}</small></span>{approvalMode(activeThread?.mode || selectedMode) === mode.id && <Check size={14}/>}</button>)}{(activeProvider === 'cursor' || activeProvider === 'opencode' || activeProvider === 'copilot') && <p>Auto asks for approval with {providerNames[activeProvider]}.</p>}</div>}
                </div>
                
              
                {activeThread?.running && <><button className="send-button stop-button" onClick={() => window.j2code.cancel(activeThread.id).catch(error => notify(String(error), 'error'))} title="Stop generation and pause queue" aria-label="Stop generation"><Square size={13} fill="currentColor" /></button></>}
                <button className="send-button" onClick={() => send()} disabled={!canSend} title={activeThread?.running ? 'Queue message (Enter)' : 'Send message'} aria-label={activeThread?.running ? 'Queue message' : 'Send message'}>{sending ? <LoaderCircle size={16} className="spin" /> : <ArrowUp size={17} />}</button>
              </div>
              <WorkspacePicker key={`${activeProject.id}:${activeThreadId || 'new'}`} projectId={activeProject.id} thread={activeThread} branch={git.branch} value={workspaceChoice} disabled={sending} onChange={value => setWorkspaceDrafts(previous => ({ ...previous, [activeProject.id]: value }))}/>
            </div>
            {!providerEnabled && <div className="composer-footnote">This provider is disabled. <button className="markdown-link" onClick={() => setSettingsOpen(true)}>Enable it in Settings</button> to send messages.</div>}
            {!providerInstalled && <div className="composer-footnote">No agent CLI found. Install one and refresh discovery in Settings.</div>}
          </div>}
        </section>

        {activeThread && activeThread.messages.length > 0 && <aside aria-label="Review changes" className={`changes-panel ${changesOpen ? 'changes-visible' : ''}`}>
          <div className="changes-header"><div><span className="panel-title">Changes</span>{changedCount > 0 && <span className="changes-count">{changedCount}</span>}</div><div className="changes-header-actions"><GitActions key={`${activeProjectId}-${changesOpen}`} repository={git.isRepository} changedCount={changedCount} selectedCount={selectedFiles.length} pushTarget={git.pushTarget} onAction={action => { if (action === 'pr') { setPrTitle(''); setPrBody(''); setPrBase(undefined); setPrTemplate(undefined); } setDialog(action); }}/><button className="icon-button" title="Refresh changes" onClick={() => activeProjectId && refreshGit(activeProjectId)} disabled={!activeProjectId}><RefreshCw size={15} className={gitLoading ? 'spin' : ''} /></button><button className="icon-button changes-close" aria-label="Close changes" title="Close changes" onClick={() => setChangesOpen(false)}><X size={16} /></button></div></div>
          <div className="review-tabs" role="group" aria-label="Review view"><button aria-pressed={reviewTab === 'files'} onClick={() => setReviewTab('files')}>Files <span>{changedCount}</span></button><button aria-pressed={reviewTab === 'activity'} onClick={() => setReviewTab('activity')}>Activity</button></div>
          {reviewTab === 'activity' ? <div className="review-activity">{activeThread && ((activeThread.activity?.length || 0) > 0 || activeThread.running) ? <ActivityFeed key={activeThread.id} items={activeThread.activity || []} running={activeThread.running}/> : <p>No agent activity in this thread yet.</p>}</div> : <div className={`changes-scroll ${selectedFile ? 'reviewing-diff' : ''}`}>{!activeProject ? <div className="changes-empty"><Folder size={23} /><strong>No project open</strong><span>Open a folder to see its changes.</span></div> : !git.isRepository ? <div className="changes-empty"><GitBranch size={23} /><strong>No Git repository</strong><span>Git changes will appear here when this folder is a repository.</span></div> : <>
            <div className="repo-summary"><GitBranch size={15} /><strong>{git.branch}</strong><span>{git.ahead > 0 ? `↑ ${git.ahead}` : ''}{git.behind > 0 ? ` ↓ ${git.behind}` : ''}</span></div>
            {changedCount === 0 ? <div className="changes-empty clean"><CircleCheck size={25} /><strong>No changes</strong><span>Your working tree is clean.</span></div> : <><div className="file-list-heading"><span>Changed files</span><span>{changedCount}</span></div><div className="file-list">{git.files.map(file => <div key={file.path} className={`file-row ${selectedFile === file.path ? 'file-selected' : ''}`}><label className="file-check" title="Select for commit"><input type="checkbox" checked={selectedFiles.includes(file.path)} onChange={() => setSelectedFiles(previous => previous.includes(file.path) ? previous.filter(path => path !== file.path) : [...previous, file.path])} /><span><Check size={10} /></span></label><button className="file-open" onClick={() => chooseFile(file.path)}><FileCode2 size={16} /><span className="file-detail"><strong>{fileName(file.path)}</strong>{fileDir(file.path) && <small>{fileDir(file.path)}</small>}</span><span className={`file-status status-${fileBadge(file).toLowerCase()}`}>{fileBadge(file)}</span></button></div>)}</div><div className="commit-bar"><button className="primary-button" onClick={() => setDialog('commit')}><GitCommitHorizontal size={15}/>{selectedFiles.length ? `Commit ${selectedFiles.length} selected` : `Commit all ${changedCount}`}</button></div></>}
            {selectedFile && <div className="diff-card"><div className="diff-heading"><FileDiff size={14} /><span title={selectedFile}>{fileName(selectedFile)}</span><button onClick={() => setSelectedFile(null)} aria-label="Close diff"><X size={13} /></button></div><div className="diff-content">{diffLoading ? <LoaderCircle className="spin" size={18} /> : diff ? diff.split('\n').map((line, index) => <div key={index} className={`diff-line ${line.startsWith('+') && !line.startsWith('+++') ? 'added' : line.startsWith('-') && !line.startsWith('---') ? 'removed' : line.startsWith('@@') ? 'hunk' : ''}`}>{line || ' '}</div>) : <span>No diff available for this file.</span>}</div></div>}
          </>}</div>}
        </aside>}
      </div>
    </> }</main>

    {dialog === 'commit' && activeProjectId && <CommitDialog projectId={activeProjectId} threadId={activeThreadId || undefined} branch={git.branch} pushTarget={git.pushTarget} files={git.files} initial={selectedFiles} writer={commitWriter} onRefresh={() => { if (activeProjectId) void refreshGit(activeProjectId); }} notify={notify} onClose={() => setDialog(null)} onCommitted={() => { setDialog(null); setSelectedFiles([]); if (activeProjectId) void refreshGit(activeProjectId); }}/>}
    {dialog && dialog !== 'commit' && <div className="modal-backdrop" onMouseDown={event => { if (!busy && event.target === event.currentTarget) setDialog(null); }}><div className={`dialog ${dialog === 'pr' ? 'pr-dialog' : ''}`} role="dialog" aria-modal="true"><div className="dialog-head"><div className="dialog-icon">{dialog === 'push' ? <ArrowUp size={21} /> : dialog === 'pr' ? <GitPullRequest size={21} /> : dialog === 'removeProject' ? <Folder size={21} /> : <Trash2 size={21} />}</div><button className="icon-button" onClick={() => setDialog(null)} disabled={busy} aria-label="Close"><X size={18} /></button></div><h2>{dialog === 'push' ? 'Push branch' : dialog === 'pr' ? 'Create pull request' : dialog === 'removeProject' ? 'Remove project' : 'Delete thread'}</h2>
      {dialog === 'push' && <p>Push <strong>{git.branch}</strong> to <strong>{git.pushTarget || 'an upstream branch'}</strong>. {git.ahead > 0 ? `${git.ahead} commit${git.ahead === 1 ? '' : 's'} ahead.` : ''}</p>}
      {dialog === 'pr' && <><p>Open a pull request for <strong>{git.branch}</strong>. {!git.pushTarget ? 'Configure an upstream branch first.' : git.ahead > 0 ? `Push ${git.ahead} local commit${git.ahead === 1 ? '' : 's'} before creating the pull request.` : `Branch is pushed to ${git.pushTarget}.`}</p><button className="generate-button" disabled={busy || !commitWriter} onClick={async () => {
        if (!activeProjectId || !commitWriter || busy) return;
        setBusy(true);
        try {
          const draft = await window.j2code.generatePR({ projectId: activeProjectId, threadId: activeThreadId || undefined, provider: commitWriter.provider, model: commitWriter.model });
          setPrTitle(draft.title); setPrBody(draft.body); setPrBase(draft.base); setPrTemplate(draft.template);
        } catch (error) { notify(String(error), 'error'); }
        finally { setBusy(false); }
      }}>{busy ? 'Working…' : prTitle || prBody ? 'Regenerate PR' : 'Generate PR'}</button>
      <small className="commit-hint">{prTemplate ? `Using ${prTemplate}` : 'Draft from branch changes and the repository’s PR template.'}{prBase ? ` Base: ${prBase}.` : ''}</small><label className="field-label" htmlFor="pr-title">Title</label><input id="pr-title" disabled={busy} maxLength={300} autoFocus value={prTitle} onChange={event => setPrTitle(event.target.value)} placeholder="What does this change?" /><label className="field-label" htmlFor="pr-body">Description</label><textarea id="pr-body" disabled={busy} maxLength={20000} value={prBody} onChange={event => setPrBody(event.target.value)} placeholder="Add context for reviewers…" rows={5} /><label className="draft-toggle"><input type="checkbox" checked={prDraft} disabled={busy} onChange={event => setPrDraft(event.target.checked)} /><span>Open as draft</span></label></>}
      {dialog === 'delete' && <p>Delete <strong>{activeThread?.title || 'this thread'}</strong>? The conversation will be removed from this workspace.</p>}
      {dialog === 'removeProject' && <p>Remove <strong>{projectToRemove?.name}</strong> from Conduit? Its conversations will be removed from the app. The folder and files stay on disk.</p>}

      <div className="dialog-actions"><button className="ghost-button" disabled={busy} onClick={() => setDialog(null)}>Cancel</button><button className={`primary-button ${dialog === 'delete' || dialog === 'removeProject' ? 'danger-button' : ''}`} onClick={performAction} disabled={busy || (dialog === 'push' && !git.pushTarget) || (dialog === 'pr' && (!prTitle.trim() || !git.pushTarget || git.ahead > 0))}>{busy ? <LoaderCircle size={16} className="spin" /> : dialog === 'push' ? <ArrowUp size={16} /> : dialog === 'pr' ? <GitPullRequest size={16} /> : dialog === 'removeProject' ? <Folder size={16} /> : <Trash2 size={16} />}{dialog === 'push' ? 'Push branch' : dialog === 'pr' ? 'Create PR' : dialog === 'removeProject' ? 'Remove project' : 'Delete thread'}</button></div></div></div>}
    {toast && <div className={`toast toast-${toast.kind}`}>{toast.kind === 'success' ? <CircleCheck size={17} /> : <CircleAlert size={17} />}{toast.text}<button onClick={() => setToast(null)} aria-label="Dismiss"><X size={14} /></button></div>}
  </div>;
}
