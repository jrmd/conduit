import { useState } from 'react';
import { Bot, Brain, Check, ChevronRight, Terminal, LoaderCircle, CircleAlert } from 'lucide-react';
import type { Activity } from '../shared/api';

/** One turn's work stays between its prompt and answer, rather than in a separate dashboard. */
export function ActivityFeed({ items, running, waiting }: { items: Activity[]; running?: boolean; waiting?: boolean }) {
  const [opened, setOpened] = useState<boolean | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (!items.length && !running) return null;
  const expanded = opened ?? !!running;
  const roots = items.filter(item => !item.parentId || !items.some(parent => parent.id === item.parentId));
  const agents = items.filter(item => item.kind === 'agent');
  const pending = roots.filter(item => item.status === 'running');
  const latest = pending.at(-1) || roots.at(-1);
  const rows = running && !showAll ? roots.slice(-5) : roots;
  const icon = (item: Activity) => item.status === 'running' ? <LoaderCircle size={13} className="spin" /> : item.kind === 'agent' ? <Bot size={13} /> : item.kind === 'reasoning' ? <Brain size={13} /> : <Terminal size={13} />;
  function row(item: Activity, depth = 0): React.ReactNode {
    const children = depth < 4 ? items.filter(child => child.parentId === item.id && child.id !== item.id) : [];
    return <details className={`activity-item activity-${item.status}`} key={item.id}>
      <summary>{icon(item)}<span>{item.title}</span>{item.status !== 'completed' && <small>{item.status === 'unknown' ? 'unreported' : item.status}</small>}<ChevronRight size={12} /></summary>
      {item.detail && <pre>{item.detail}</pre>}
      {children.length > 0 && <div className="activity-children">{children.map(child => row(child, depth + 1))}</div>}
    </details>;
  }
  return <div className={`activity-feed activity-inline ${running ? 'is-live' : ''}`}>
    <button className="activity-toggle" aria-expanded={expanded} disabled={!items.length} onClick={() => setOpened(!expanded)}>
      {waiting ? <CircleAlert size={13}/> : running ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}
      <span role={running ? 'status' : undefined}>{waiting ? 'Waiting for approval' : running ? latest?.title || 'Working…' : `Worked through ${roots.length} ${roots.length === 1 ? 'step' : 'steps'}`}</span>
      {agents.length > 0 && <small><Bot size={12} />{agents.length}</small>}
      {items.length > 0 && <ChevronRight size={12} className={expanded ? 'rotate-down' : ''} />}
    </button>
    {expanded && items.length > 0 && <div className="activity-flow">
      {running && roots.length > rows.length && <button className="activity-more" onClick={() => setShowAll(true)}>Show {roots.length - rows.length} earlier steps</button>}
      {rows.map(item => row(item))}
    </div>}
  </div>;
}
