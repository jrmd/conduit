import { useEffect, useRef, useState } from 'react';
import { Check, GitCommitHorizontal, LoaderCircle, Sparkles, X } from 'lucide-react';
import type { ChangedFile, ProviderId } from '../shared/api';

function fileName(path: string) { return path.split('/').pop() || path; }
function fileDir(path: string) { return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; }
function badge(file: ChangedFile) {
  if (file.untracked) return 'U';
  const status = file.status.trim();
  return status.includes('D') ? 'D' : status.includes('A') || status.includes('?') ? 'A' : status.includes('R') ? 'R' : 'M';
}

/** Commits every changed file unless the reader narrows the list; the message can be drafted from the diff. */
export function CommitDialog({ projectId, threadId, branch, files, initial, writer, onClose, onCommitted, notify }: {
  projectId: string;
  threadId?: string;
  branch: string;
  files: ChangedFile[];
  initial: string[];
  writer: { provider: ProviderId; model?: string; label: string } | null;
  onClose(): void;
  onCommitted(): void;
  notify(text: string, kind?: 'success' | 'error'): void;
}) {
  const [chosen, setChosen] = useState<string[]>(() => initial.length ? initial : files.map(file => file.path));
  const [message, setMessage] = useState('');
  const [generating, setGenerating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const mounted = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { mounted.current = true; input.current?.focus(); return () => { mounted.current = false; }; }, []);
  // Drop files that were committed or reverted elsewhere while the dialog was open.
  useEffect(() => { setChosen(previous => previous.filter(path => files.some(file => file.path === path))); }, [files]);

  const all = files.length > 0 && chosen.length === files.length;
  const locked = generating || committing;
  const canCommit = !!message.trim() && chosen.length > 0 && !committing && !generating;
  const toggle = (path: string) => setChosen(previous => previous.includes(path) ? previous.filter(item => item !== path) : [...previous, path]);

  async function generate() {
    if (!writer || !chosen.length || generating || committing) return;
    setGenerating(true);
    try {
      const text = await window.j2code.generateCommitMessage({ projectId, threadId, files: chosen, provider: writer.provider, model: writer.model });
      if (mounted.current) { setMessage(text); input.current?.focus(); }
    } catch (error) { notify(String(error), 'error'); }
    finally { if (mounted.current) setGenerating(false); }
  }

  async function commit() {
    if (!canCommit) return;
    setCommitting(true);
    try {
      await window.j2code.commit({ projectId, threadId, files: chosen, message: message.trim() });
      notify(`Committed ${chosen.length} ${chosen.length === 1 ? 'file' : 'files'}`);
      onCommitted();
    } catch (error) { notify(String(error), 'error'); }
    finally { if (mounted.current) setCommitting(false); }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (!committing && event.target === event.currentTarget) onClose(); }} onKeyDown={event => { if (!committing && event.key === 'Escape') onClose(); }}>
    <div className="dialog commit-dialog" role="dialog" aria-modal="true" aria-labelledby="commit-title">
      <div className="dialog-head"><div className="dialog-icon"><GitCommitHorizontal size={20}/></div><button className="icon-button" onClick={onClose} disabled={committing} aria-label="Close"><X size={18}/></button></div>
      <h2 id="commit-title">Commit changes</h2>
      <p>{all ? 'All changes' : `${chosen.length} of ${files.length} files`} on <strong>{branch || 'the current branch'}</strong>.</p>

      <div className="commit-files" role="group" aria-label="Files to commit">
        <label className="commit-file commit-file-all">
          <input type="checkbox" disabled={locked} checked={all} ref={element => { if (element) element.indeterminate = chosen.length > 0 && !all; }} onChange={() => setChosen(all ? [] : files.map(file => file.path))}/>
          <span className="commit-check" aria-hidden="true"><Check size={10}/></span>
          <span className="commit-file-name">{all ? 'All files' : 'Select all'}</span><small>{chosen.length}/{files.length}</small>
        </label>
        <div className="commit-file-list">{files.map(file => <label className="commit-file" key={file.path} title={file.path}>
          <input type="checkbox" disabled={locked} checked={chosen.includes(file.path)} onChange={() => toggle(file.path)}/>
          <span className="commit-check" aria-hidden="true"><Check size={10}/></span>
          <span className="commit-file-name">{fileName(file.path)}{fileDir(file.path) && <small>{fileDir(file.path)}</small>}</span>
          <span className={`file-status status-${badge(file).toLowerCase()}`}>{badge(file)}</span>
        </label>)}</div>
      </div>

      <div className="commit-message-head">
        <label className="field-label" htmlFor="commit-message">Commit message</label>
        <button className="generate-button" type="button" disabled={!writer || !chosen.length || locked} onClick={generate} title={writer ? `Draft from the diff with ${writer.label}` : 'Enable an agent in Settings to draft messages'}>
          {generating ? <LoaderCircle size={13} className="spin"/> : <Sparkles size={13}/>}{generating ? 'Writing…' : message.trim() ? 'Regenerate' : 'Generate'}
        </button>
      </div>
      <textarea id="commit-message" maxLength={1000} readOnly={locked} ref={input} className={generating ? 'is-generating' : undefined} value={message} onChange={event => setMessage(event.target.value)} rows={4} placeholder="Summarise the change, or generate a message from the diff"
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void commit(); } }}/>
      <small className="commit-hint">{navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl'} + Enter to commit</small>

      <div className="dialog-actions">
        <button className="ghost-button" disabled={committing} onClick={onClose}>Cancel</button>
        <button className="primary-button" onClick={commit} disabled={!canCommit}>{committing ? <LoaderCircle size={16} className="spin"/> : <GitCommitHorizontal size={16}/>}Commit</button>
      </div>
    </div>
  </div>;
}
