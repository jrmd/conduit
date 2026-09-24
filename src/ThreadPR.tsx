import { useEffect, useState } from 'react';
import { GitPullRequest, RefreshCw } from 'lucide-react';
import type { Thread } from '../shared/api';
export function ThreadPR({ thread }: { thread: Thread }) {
  const [pr, setPR] = useState<Awaited<ReturnType<typeof window.j2code.threadPR>>>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let disposed = false, pending = false;
    setPR(null); setError('');
    if (!thread.branch || !thread.repository) return;
    async function check() {
      if (pending || document.hidden) return;
      pending = true; setLoading(true);
      try { const result = await window.j2code.threadPR(thread.id); if (!disposed) { setPR(result); setError(''); } }
      catch (failure) { if (!disposed) setError(String(failure)); }
      finally { pending = false; if (!disposed) setLoading(false); }
    }
    void check(); const timer = setInterval(check, 60000);
    window.addEventListener('focus', check);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', check); };
  }, [thread.id, thread.branch, thread.repository, refresh]);
  if (!thread.branch || !thread.repository || !pr) return null;
  return <div className="thread-pr">
    <button className="thread-pr-link" title={`${pr.title} · ${pr.state}`} onClick={() => window.j2code.openExternal(pr.url).catch(e => setError(String(e)))}><GitPullRequest size={14}/><span>#{pr.number}</span><span>View in GitHub</span></button>
    <button className="icon-button" aria-label="Refresh thread PR" title={error || 'Refresh thread PR'} disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={12} className={loading ? 'spin' : ''}/></button>
  </div>;
}
