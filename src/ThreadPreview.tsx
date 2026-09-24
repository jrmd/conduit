import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Folder, GitBranch } from 'lucide-react';

/** A portal keeps previews clear of the sidebar's scrolling containers. */
export function ThreadPreview({ title, project, branch, model, icon, className, children }: {
  title: string; project: string; branch?: string | null; model: string; icon: ReactNode; className: string; children: ReactNode;
}) {
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [position, setPosition] = useState<{left: number; top: number} | null>(null);
  const [closing, setClosing] = useState(false);
  function close() {
    clearTimeout(timer.current);
    clearTimeout(exitTimer.current);
    setClosing(true);
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 120;
    exitTimer.current = setTimeout(() => setPosition(null), duration);
  }
  function open(delay = 320) {
    clearTimeout(timer.current);
    clearTimeout(exitTimer.current);
    setClosing(false);
    timer.current = setTimeout(() => {
      const box = host.current?.getBoundingClientRect();
      if (box) setPosition({left: Math.max(8, Math.min(box.right + 8, window.innerWidth - 268)), top: Math.max(8, Math.min(box.top, window.innerHeight - 220))});
    }, delay);
  }
  function leave() { clearTimeout(timer.current); timer.current = setTimeout(close, 100); }
  useEffect(() => {
    const dismiss = () => close();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('keydown', escape);
    return () => { clearTimeout(timer.current); clearTimeout(exitTimer.current); window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss); window.removeEventListener('keydown', escape); };
  }, []);
  return <div ref={host} className={className} onMouseEnter={() => open()} onMouseLeave={leave} onFocus={() => open(150)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }} onClick={close} onContextMenu={close} aria-describedby={position ? id : undefined}>
    {children}
    {position && createPortal(<div id={id} role="tooltip" className="thread-preview" data-closing={closing} style={position} onMouseEnter={() => { clearTimeout(timer.current); clearTimeout(exitTimer.current); setClosing(false); }} onMouseLeave={leave}>
      <strong>{title}</strong>
      <span><Folder size={14}/>{project}</span>
      {branch && <span><GitBranch size={14}/>{branch}</span>}
      <span>{icon}{model}</span>
    </div>, document.body)}
  </div>;
}
