import { useState } from 'react';
import { Check, Circle, LoaderCircle } from 'lucide-react';
import type { Thread } from '../shared/api';
import { MessageMarkdown } from './MessageMarkdown';

export function PlanCard({ thread, onHandoff, onError }: { thread: Thread; onHandoff: (thread: Thread) => void; onError: (error: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (!thread.plan) return null;
  const plan = thread.plan;
  return <section className="plan-card" aria-label="Implementation plan">
    <details open><summary>Plan <span>{plan.steps.filter(s => s.status === 'completed').length}/{plan.steps.length} complete</span></summary>
      <ol>{plan.steps.map((step, index) => <li key={index} data-status={step.status}>{step.status === 'completed' ? <Check size={14}/> : step.status === 'in_progress' ? <LoaderCircle size={14}/> : <Circle size={14}/>}<span>{step.text}</span><small>{step.status.replace('_', ' ')}</small></li>)}</ol>
      {plan.brief && <details><summary>Handoff brief</summary><MessageMarkdown text={plan.brief}/></details>}
    </details>
    {thread.handoff && !thread.messages.length ? <p>Fresh context ready. Choose a provider and model below, then send to begin.</p> : <button disabled={busy || thread.running || !plan.brief.trim()} onClick={async () => {
      setBusy(true);
      try { onHandoff(await window.j2code.handoffPlan(thread.id)); }
      catch (error) { onError(String(error)); }
      finally { setBusy(false); }
    }}>Start fresh from plan</button>}
  </section>;
}
