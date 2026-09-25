import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Check, ChevronRight, RefreshCw } from 'lucide-react';
import type { ModelCatalogue, ProviderId, Snapshot, UpdateStatus } from '../shared/api';
import { modelFamilies } from '../shared/model-options';
import type { Appearance } from './appearance';
import { providerIcons, providerIds, providerNames } from './providers';
import { SummarySettings, type SummaryChoice } from './SummarySettings';

const tabs = [['appearance', 'Appearance'], ['providers', 'Agents'], ['summaries', 'Thread titles'], ['updates', 'Updates']] as const;
const themes = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']] as const;

interface SettingsScreenProps {
  leading: ReactNode;
  version: string;
  tab: string;
  onTab(tab: string): void;
  onClose(): void;
  appearance: Appearance;
  onAppearance(value: Appearance): void;
  updateStatus: UpdateStatus;
  onUpdateStatus(status: UpdateStatus): void;
  snapshot: Snapshot;
  onSnapshot: Dispatch<SetStateAction<Snapshot>>;
  summaryChoice: SummaryChoice | null;
  onSummaryChoice(choice: SummaryChoice | null): void;
  modelCatalogues: Partial<Record<ProviderId, ModelCatalogue>>;
  hiddenModels: string[];
  onToggleModel(key: string): void;
  notify(text: string, kind?: 'success' | 'error'): void;
}

export function SettingsScreen(props: SettingsScreenProps) {
  const { tab, snapshot, updateStatus, notify } = props;
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); } catch (error) { notify(String(error), 'error'); } finally { setBusy(false); }
  }

  function onTabKey(event: React.KeyboardEvent, index: number) {
    const offset = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : offset ? (index + offset + tabs.length) % tabs.length : -1;
    if (next < 0) return;
    event.preventDefault();
    props.onTab(tabs[next][0]);
    document.getElementById(`settings-tab-${tabs[next][0]}`)?.focus();
  }

  const panel = (id: string) => ({ className: 'settings-panel', role: 'tabpanel', id: `settings-panel-${id}`, 'aria-labelledby': `settings-tab-${id}`, hidden: tab !== id, tabIndex: 0 });
  const updateMessage = updateStatus.state === 'current' ? `Version ${updateStatus.version} is current`
    : updateStatus.state === 'downloading' ? `Downloading ${updateStatus.version} · ${updateStatus.percent || 0}%`
    : updateStatus.state === 'ready' ? `Version ${updateStatus.version} is ready`
    : updateStatus.message || 'Checks GitHub automatically; restart when you are ready.';

  return <>
    <header className="topbar settings-topbar">{props.leading}<button className="ghost-button" onClick={props.onClose}><ChevronRight size={15} className="back-chevron"/>Back to chat</button><strong>Settings</strong></header>
    <section className="settings-screen" aria-label="Settings"><div className="settings-content">
      <h1>Settings</h1>
      <nav className="settings-nav" role="tablist" aria-label="Settings sections">
        {tabs.map(([id, label], index) => <button key={id} role="tab" id={`settings-tab-${id}`} aria-selected={tab === id} aria-controls={`settings-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => props.onTab(id)} onKeyDown={event => onTabKey(event, index)}>{label}</button>)}
      </nav>
      <p className="settings-intro">Conduit <span>v{props.version}</span></p>

      <section {...panel('appearance')}><div id="settings-appearance" className="appearance-settings">
        <h2>Appearance</h2><p>Choose a theme or follow your system.</p>
        <div className="appearance-options" role="group" aria-label="Appearance">
          {themes.map(([value, label]) => <button key={value} aria-pressed={props.appearance === value} onClick={() => props.onAppearance(value)}><span className={`theme-swatch theme-swatch-${value}`} aria-hidden="true"><i/><i/><i/></span>{label}{props.appearance === value && <Check size={14}/>}</button>)}
        </div>
      </div></section>

      <section {...panel('updates')}><div id="settings-updates" className="update-settings">
        <div><strong>Conduit updates</strong><small>{updateMessage}</small></div>
        <button className="ghost-button" disabled={['checking', 'downloading', 'unsupported'].includes(updateStatus.state)} onClick={() => run(async () => {
          if (updateStatus.state === 'ready') await window.j2code.installUpdate();
          else props.onUpdateStatus(await window.j2code.checkForUpdates());
        })}>{updateStatus.state === 'ready' ? 'Restart to update' : updateStatus.state === 'checking' ? 'Checking…' : 'Check for updates'}</button>
      </div></section>

      <section {...panel('summaries')}><div id="settings-summaries">
        <SummarySettings providers={snapshot.providers.filter(p => p.available && !snapshot.disabledProviders.includes(p.id))} choice={props.summaryChoice} onChange={props.onSummaryChoice}/>
      </div></section>

      <section {...panel('providers')}>
        <h2 id="settings-providers">Agents</h2><p>Choose the installed CLIs available in the model picker.</p>
        <div className="agent-list">{providerIds.map(id => {
          const provider = snapshot.providers.find(p => p.id === id);
          const Icon = providerIcons[id];
          return <div className="agent-row" key={id}>
            <span className="agent-initial"><Icon width={21} height={21}/></span>
            <span><strong>{providerNames[id]}</strong><small>{provider?.available ? provider.version || provider.path || 'Installed · sign-in may be required' : provider?.error || 'Not installed'}</small></span>
            <span className={`agent-state ${provider?.available ? 'installed' : ''}`}>{provider?.available ? 'Installed' : 'Missing'}</span>
            <button className="provider-toggle" role="switch" aria-label={`Enable ${providerNames[id]}`} aria-checked={!snapshot.disabledProviders.includes(id)} disabled={busy} onClick={() => run(async () => {
              await window.j2code.setProviderEnabled(id, snapshot.disabledProviders.includes(id));
              props.onSnapshot(await window.j2code.getSnapshot());
            })}><span/></button>
          </div>;
        })}</div>
        <button className="ghost-button refresh-agents" disabled={busy} onClick={() => run(async () => {
          const providers = await window.j2code.discover();
          props.onSnapshot(previous => ({ ...previous, providers }));
          notify('Agent discovery refreshed');
        })}><RefreshCw size={14} className={busy ? 'spin' : ''}/>Refresh discovery</button>
        <div className="model-visibility"><h2>Model visibility</h2><p>Choose models to show in the selector. Existing threads keep their model.</p>
          {snapshot.providers.filter(provider => provider.available).map(provider => <details key={provider.id}><summary><ChevronRight size={14}/>{provider.name}</summary><div className="model-visibility-list">
            {!props.modelCatalogues[provider.id] && <p>Loading models…</p>}
            {[{ id: '', label: 'CLI default' }, ...modelFamilies(provider.id, props.modelCatalogues[provider.id]?.options || [])].map(option => <label key={option.id}>{option.label}<button type="button" className="provider-toggle" role="switch" aria-label={`Show ${provider.name} ${option.label}`} aria-checked={!props.hiddenModels.includes(`${provider.id}:${option.id}`)} onClick={() => props.onToggleModel(`${provider.id}:${option.id}`)}><span/></button></label>)}
          </div></details>)}
        </div>
      </section>
    </div></section>
  </>;
}
