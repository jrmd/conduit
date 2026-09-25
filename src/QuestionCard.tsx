import { useState } from 'react';
import type { QuestionAnswers, QuestionRequest } from '../shared/api';

export function QuestionCard({ request, onError }: { request: QuestionRequest; onError: (error: string) => void }) {
  const [answers, setAnswers] = useState<QuestionAnswers>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const values = Object.fromEntries(request.questions.map(q => [q.id, custom[q.id]?.trim() ? [...(q.multiple ? answers[q.id] || [] : []), custom[q.id].trim()] : answers[q.id] || []]));
  async function submit(skip = false) {
    setBusy(true);
    try { await window.j2code.respondQuestion(request.id, request.threadId, skip ? null : values); }
    catch (error) { onError(String(error)); }
    finally { setBusy(false); }
  }
  return <form className="question-card" aria-label="Questions from agent" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <strong>Your input is needed</strong>
    {request.questions.map(q => <fieldset key={q.id} disabled={busy}><legend>{q.text}</legend>
      {q.options.map(option => <label key={option.value}><input type={q.multiple ? 'checkbox' : 'radio'} name={`${request.id}-${q.id}`} checked={(answers[q.id] || []).includes(option.value)} onChange={event => {
        setCustom(previous => ({ ...previous, [q.id]: '' }));
        setAnswers(previous => ({ ...previous, [q.id]: q.multiple ? event.target.checked ? [...(previous[q.id] || []), option.value] : (previous[q.id] || []).filter(v => v !== option.value) : [option.value] }));
      }}/><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>)}
      {q.freeText && <input type={q.secret ? 'password' : 'text'} autoComplete="off" aria-label={`Your answer: ${q.text}`} placeholder="Write your own answer…" value={custom[q.id] || ''} onChange={event => setCustom(previous => ({ ...previous, [q.id]: event.target.value }))}/>}
    </fieldset>)}
    <div className="question-actions"><button type="button" disabled={busy} onClick={() => submit(true)}>Skip</button><button disabled={busy || request.questions.some(q => !values[q.id].length)}>Submit answers</button></div>
  </form>;
}
