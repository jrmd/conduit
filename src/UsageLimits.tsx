import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { LimitWindow, LimitsProvider, ProviderLimits, Snapshot } from '../shared/api';
import { providerIcons, providerNames } from './providers';
import './usage-limits.css';

const limitProviders: LimitsProvider[] = ['claude', 'codex'];
const resetTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

function untilReset(resetsAt: number, now: number) {
  const minutes = Math.max(0, Math.round((resetsAt - now) / 60000));
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), rest = minutes % 60;
  const left = days ? `${days}d ${hours}h` : hours ? `${hours}h ${rest}m` : `${rest}m`;
  return `Resets in ${left} · ${resetTime.format(resetsAt)}`;
}

function LimitBar({ window, now }: { window: LimitWindow; now: number }) {
  const used = Math.round(window.usedPercent);
  return <div className="limit-window" data-level={used >= 90 ? 'critical' : used >= 75 ? 'high' : undefined}>
    <div className="limit-window-heading"><strong>{window.label}</strong><span>{used}% used</span></div>
    <div className="limit-bar" role="meter" aria-label={window.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used}><i style={{ width: `${used}%` }} /></div>
    {window.resetsAt && <small>{untilReset(window.resetsAt, now)}</small>}
  </div>;
}

/** Plan limits for CLIs that expose them; loads when the tab is first shown. */
export function UsageLimits({ active, snapshot }: { active: boolean; snapshot: Snapshot }) {
  const providers = limitProviders.filter(id => snapshot.providers.some(p => p.id === id && p.available) && !snapshot.disabledProviders.includes(id));
  const [limits, setLimits] = useState<Partial<Record<LimitsProvider, ProviderLimits>>>({});
  const [loading, setLoading] = useState<LimitsProvider[]>([]);
  const [now, setNow] = useState(Date.now());
  const load = useCallback((provider: LimitsProvider) => {
    setLoading(previous => [...previous, provider]);
    window.j2code.getLimits(provider)
      .then(result => setLimits(previous => ({ ...previous, [provider]: result })))
      .catch(error => setLimits(previous => ({ ...previous, [provider]: { provider, windows: [], notes: [], warning: String(error), fetchedAt: Date.now() } })))
      .finally(() => { setLoading(previous => previous.filter(id => id !== provider)); setNow(Date.now()); });
  }, []);
  const key = providers.join();
  useEffect(() => { if (active) for (const provider of providers) if (!limits[provider]) load(provider); }, [active, key]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [active]);

  return <div className="usage-limits">
    <h2>Usage</h2><p>Plan limits reported by each signed-in CLI. Checking limits does not use any.</p>
    {!providers.length && <p className="usage-limits-empty">Install and enable Claude Code or Codex to see plan limits. Other CLIs do not report them.</p>}
    {providers.map(id => {
      const result = limits[id], busy = loading.includes(id), Icon = providerIcons[id];
      return <section className="usage-provider" key={id} aria-busy={busy}>
        <header>
          <Icon width={18} height={18} aria-hidden="true" />
          <strong>{providerNames[id]}</strong>
          {result?.plan && <span className="usage-plan">{result.plan}</span>}
          <button className="icon-button" title={`Refresh ${providerNames[id]} limits`} aria-label={`Refresh ${providerNames[id]} limits`} disabled={busy} onClick={() => load(id)}><RefreshCw size={14} className={busy ? 'spin' : ''} /></button>
        </header>
        {!result && <small>Checking limits…</small>}
        {result?.warning && <p className="usage-warning">{result.warning}</p>}
        {result?.windows.map(window => <LimitBar key={window.label} window={window} now={now} />)}
        {!!result?.notes.length && <ul className="usage-notes">{result.notes.map(note => <li key={note}>{note}</li>)}</ul>}
        {result && <small className="usage-updated">Updated {resetTime.format(result.fetchedAt)}</small>}
      </section>;
    })}
  </div>;
}
