import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, GitCommitHorizontal, GitPullRequest } from 'lucide-react';

export function GitActions({ repository, selectedCount, pushTarget, onAction }: {
  repository: boolean;
  selectedCount: number;
  pushTarget?: string;
  onAction(action: 'commit' | 'push' | 'pr'): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function choose(action: 'commit' | 'push' | 'pr') {
    setOpen(false);
    trigger.current?.focus();
    onAction(action);
  }
  return <div className="git-actions" ref={root} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    if (event.key === 'Tab') setOpen(false);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    }
  }}>
    <button ref={trigger} className="git-actions-trigger" aria-label="Git actions" aria-haspopup="menu" aria-expanded={open} disabled={!repository} title={repository ? 'Commit, push or create a pull request' : 'Open a Git repository to use Git actions'} onClick={() => setOpen(!open)}><GitCommitHorizontal size={14}/><span>Actions</span><ChevronDown size={13}/></button>
    {open && <div ref={menu} className="git-actions-menu" role="menu" aria-label="Git actions">
      <button role="menuitem" disabled={!selectedCount} onClick={() => choose('commit')} title={selectedCount ? `Commit ${selectedCount} selected files` : 'Select files to commit'}><GitCommitHorizontal size={16}/><span>Commit changes</span>{selectedCount > 0 && <small>{selectedCount}</small>}</button>
      <button role="menuitem" disabled={!pushTarget} onClick={() => choose('push')} title={pushTarget ? `Push to ${pushTarget}` : 'Configure an upstream branch to push'}><ArrowUp size={16}/><span>Push branch</span></button>
      <button role="menuitem" onClick={() => choose('pr')}><GitPullRequest size={16}/><span>Create pull request</span></button>
    </div>}
  </div>;
}
