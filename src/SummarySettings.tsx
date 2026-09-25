import { useEffect, useState } from 'react';
import type { ModelOption, ProviderId, ProviderInfo } from '../shared/api';
export type SummaryChoice = { provider: ProviderId; model: string };
export function readSummaryChoice(): SummaryChoice | null {
  try { const value = JSON.parse(localStorage.getItem('conduit.summary-model') || 'null'); return value && ['codex','claude','cursor','opencode','copilot'].includes(value.provider) && typeof value.model === 'string' ? value : null; } catch { return null; }
}
export function SummarySettings({ providers, choice, onChange }: { providers: ProviderInfo[]; choice: SummaryChoice | null; onChange(choice: SummaryChoice | null): void }) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true; setModels([]); setError('');
    if (choice && providers.some(p => p.id === choice.provider)) window.j2code.getModels(choice.provider).then(result => { if (current) setModels(result.options); }).catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [choice?.provider, providers.map(p => p.id).join(',')]);
  return <section className="summary-settings"><h2>Thread titles</h2><p>A short title is generated from your first message. Choose a model below, or use the thread’s model by default. Title generation runs in a separate CLI session.</p>
    <label>Provider<select aria-label="Title provider" value={choice?.provider || ''} onChange={event => onChange(event.target.value ? { provider: event.target.value as ProviderId, model: '' } : null)}><option value="">Use thread model</option>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {choice && <label>Model<select aria-label="Title model" value={choice.model} onChange={event => onChange({ ...choice, model: event.target.value })}><option value="">CLI default</option>{models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}{choice.model && !models.some(m => m.id === choice.model) && <option value={choice.model}>{choice.model}</option>}</select></label>}
    {error && <p role="status">{error}</p>}
  </section>;
}
