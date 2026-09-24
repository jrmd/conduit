import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Folder, GitBranch, GitFork, Plus, Search } from 'lucide-react';
import type { Thread, WorkspaceChoice, WorkspaceInfo } from '../shared/api';
import './workspace-picker.css';

export function WorkspacePicker({ projectId, thread, branch, value, onChange, disabled }: {
  projectId: string; thread: Thread | null; branch: string; value: WorkspaceChoice;
  onChange(value: WorkspaceChoice): void; disabled: boolean;
}) {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [open, setOpen] = useState<'location' | 'branch' | null>(null);
  const [creating, setCreating] = useState(false);
  const [choosingBase, setChoosingBase] = useState(false);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [base, setBase] = useState<string | undefined>();
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const locationButton = useRef<HTMLButtonElement>(null);
  const branchButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const locked = disabled || !!thread;
  const mode = thread?.workspace?.mode || value.mode;
  function close() {
    setOpen(null);
    (open === 'location' ? locationButton : branchButton).current?.focus();
  }
  function showBranches(create = mode === 'worktree' || !!value.newBranch) {
    setCreating(create); setChoosingBase(false); setQuery('');
    setName(value.newBranch || ''); setBase(value.branch); setOpen('branch');
  }
  useEffect(() => {
    let alive = true;
    const refresh = () => window.j2code.getWorkspace(projectId).then(result => {
      if (alive) { setInfo(result); setError(''); }
    }).catch(error => { if (alive) setError(String(error)); });
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { alive = false; window.removeEventListener('focus', refresh); };
  }, [projectId, open]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('input, button')?.focus();
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(null); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, creating, choosingBase]);
  const current = info?.current || 'Detached HEAD';
  const branches = [...new Set([info?.current, ...(info?.branches || [])].filter((name): name is string => !!name))].filter(name => name.toLowerCase().includes(query.toLowerCase()));
  const validName = !!name.trim() && !/\s|\.\.|[~^:?*\[\\]|@\{|\/\/|^[-/.]|[/.]$|\.lock$/.test(name.trim()) && name.trim() !== '@' && !info?.branches.includes(name.trim());
  return <div className="workspace-row" ref={ref}>
    <button ref={locationButton} className="workspace-location" aria-label="Workspace location" aria-expanded={open === 'location'} disabled={locked || !info?.isRepository} title={thread?.workspace?.path || 'Choose where this thread will work'} onClick={() => setOpen(open === 'location' ? null : 'location')}>
      {mode === 'worktree' ? <GitFork size={13}/> : <Folder size={13}/>}<span>{mode === 'local' ? 'Current checkout' : thread ? 'Worktree' : 'New worktree'}</span>{!thread && <ChevronDown size={11}/>}
    </button>
    <button ref={branchButton} className="workspace-branch" aria-label="Choose branch" aria-expanded={open === 'branch'} disabled={locked || !info?.isRepository} title={thread ? 'Start a new thread to choose another workspace' : 'Choose a branch before sending'} onClick={() => open === 'branch' ? close() : showBranches()}>
      <GitBranch size={13}/><span>{thread ? branch || thread.branch || 'Detached HEAD' : value.newBranch || value.branch || info?.current || (info?.isRepository ? 'Detached HEAD' : 'No Git repository')}</span>{!thread && <ChevronDown size={11}/>}
    </button>
    {open && <div ref={menu} className={`workspace-menu workspace-menu-${open}`} role="dialog" aria-label={open === 'location' ? 'Choose workspace' : 'Choose workspace branch'} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    }}>
      {open === 'location' ? <>
        <div className="workspace-menu-heading">Work in</div>
        <button className="workspace-option" aria-pressed={mode === 'local'} onClick={() => { onChange({ ...value, mode: 'local', newBranch: undefined }); close(); }}>
          <Folder size={17}/><span><strong>Current checkout</strong><small>Use your local files and changes</small></span>{mode === 'local' && <Check size={14}/>}
        </button>
        <button className="workspace-option" aria-pressed={mode === 'worktree'} onClick={() => { onChange({ ...value, mode: 'worktree', newBranch: undefined }); showBranches(true); }}>
          <GitFork size={17}/><span><strong>New worktree</strong><small>Start in a separate, isolated checkout</small></span>{mode === 'worktree' && <Check size={14}/>}
        </button>
      </> : creating && !choosingBase ? <>
        <div className="workspace-menu-heading">{mode === 'worktree' ? 'New worktree branch' : 'Create a branch'}</div>
        <form className="workspace-create" onSubmit={event => { event.preventDefault(); if (validName) { onChange({ ...value, branch: base, newBranch: name.trim() }); close(); } }}>
          <label htmlFor="workspace-branch-name">Branch name</label>
          <input id="workspace-branch-name" autoFocus aria-label="New branch name" placeholder="feature/my-task" value={name} onChange={event => setName(event.target.value)}/>
          <button type="button" className="workspace-base" aria-label="Change base branch" onClick={() => { setQuery(''); setChoosingBase(true); }}><span>From</span><GitBranch size={13}/><strong>{base || current}</strong><ChevronDown size={12}/></button>
          <p>{mode === 'worktree' ? 'Your local changes stay here. The new worktree is created when you send.' : 'The new branch is checked out when you send.'}</p>
          {name && !validName && <p role="status">{info?.branches.includes(name.trim()) ? 'That branch already exists.' : 'Enter a valid Git branch name.'}</p>}
          <div className="workspace-create-actions"><button type="button" onClick={() => { if (mode === 'worktree') close(); else { setCreating(false); setQuery(''); } }}>Back</button><button type="submit" disabled={!validName}>Use branch<Check size={13}/></button></div>
        </form>
      </> : <>
        <div className="workspace-menu-heading">{choosingBase ? <button className="workspace-back" aria-label="Back to branch creation" onClick={() => setChoosingBase(false)}><ArrowLeft size={14}/>Branch from</button> : 'Switch branch'}</div>
        <label className="workspace-search"><Search size={14}/><input autoFocus aria-label="Search branches" placeholder="Search branches…" value={query} onChange={event => setQuery(event.target.value)}/></label>
        <div className="workspace-branches">
          {branches.map(name => <button className="workspace-branch-option" key={name} aria-pressed={name === (choosingBase ? base || info?.current : value.branch || info?.current)} onClick={() => {
            if (choosingBase) { setBase(name); setChoosingBase(false); }
            else { onChange({ ...value, branch: name, newBranch: undefined }); close(); }
          }}><GitBranch size={14}/><span>{name}</span>{name === info?.current && <small>Current</small>}{name === (choosingBase ? base || info?.current : value.branch || info?.current) && <Check size={13}/>}</button>)}
          {!branches.length && <p>No matching branches</p>}
        </div>
        {!choosingBase && <button className="workspace-new-branch" onClick={() => { setName(query); setBase(value.branch); setCreating(true); }}><Plus size={15}/>Create new branch{query ? ` “${query}”` : '…'}</button>}
      </>}
    </div>}
    {!thread && mode === 'worktree' && !value.newBranch && <button className="workspace-hint" onClick={() => showBranches(true)}>Name your worktree branch…</button>}
    {error && <span className="workspace-hint" role="alert">{error}</span>}
  </div>;
}
