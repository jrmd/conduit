import { useLayoutEffect, useRef } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import type { ModelOption, ModelSettings, ProviderId } from '../shared/api';
import { familyForModel, modelFamilies } from '../shared/model-options';

export function ModelControls({provider, options, model, effort, settings, disabled, saving = false, onChange}: {
  provider: ProviderId; options: ModelOption[]; model: string; effort: string; settings: ModelSettings; disabled: boolean; saving?: boolean;
  onChange: (model: string, effort: string, settings: ModelSettings) => void;
}) {
  const controlsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = controlsRef.current?.closest<HTMLElement>('.effort-menu');
    const composer = menu?.closest<HTMLElement>('.composer');
    if (!menu || !composer) return;
    const fit = () => {
      // The bottom is anchored to the trigger (or composer on narrow screens).
      // Exclude the entrance translation so its animation cannot change sizing.
      const translate = Number.parseFloat(getComputedStyle(menu).translate.split(' ')[1]) || 0;
      const bottom = menu.getBoundingClientRect().bottom - translate;
      menu.style.setProperty('--model-menu-available-height', `${Math.max(0, bottom - 12)}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(composer);
    window.addEventListener('resize', fit);
    return () => {observer.disconnect(); window.removeEventListener('resize', fit);};
  });
  const family = familyForModel(modelFamilies(provider, options), model);
  const variant = family?.variants.find(item => item.id === model);
  const option = options.find(item => item.id === model);
  const variants = family?.variants || [];
  const cursor = provider === 'cursor';
  const changeVariant = (field: 'effort' | 'context' | 'fast', value: string | boolean) => {
    const next = variants.find(item => item[field] === value && (field === 'effort' || item.effort === variant?.effort) && (field === 'context' || item.context === variant?.context) && (field === 'fast' || item.fast === variant?.fast));
    if (next) onChange(next.id, cursor ? '' : effort, settings);
  };
  const values = (field: 'effort' | 'context') => [...new Set(variants.map(item => item[field]))];
  const available = (field: 'effort' | 'context', value: string) => variants.some(item => item[field] === value && (field === 'effort' || item.effort === variant?.effort) && (field === 'context' || item.context === variant?.context) && item.fast === variant?.fast);
  const fastVariant = variants.some(item => item.fast !== variant?.fast && item.effort === variant?.effort && item.context === variant?.context);
  const labelForEffort = (value: string) => value === 'xhigh' ? 'Extra high' : value ? value[0].toUpperCase() + value.slice(1) : 'Auto';
  const fastSelected = option?.supportsFastMode ? settings.fastMode === true : variant?.fast === true;
  const setFast = (value: boolean) => option?.supportsFastMode
    ? onChange(model, effort, {...settings, fastMode: value}) : changeVariant('fast', value);
  const reset = () => {
    const baseline = variants.find(item => !item.effort && !item.context && !item.fast)
      || variants.find(item => !item.context && !item.fast) || variant;
    onChange(baseline?.id || model, '', {});
  };
  const choices = (name: string, selected: string, items: {value: string; label: string; disabled?: boolean; isDefault?: boolean; detail?: string}[], change: (value: string) => void, compact = false) => <section className="model-control-section">
    <div className="model-control-heading"><span>{name === 'Reasoning level' ? 'Reasoning' : name}</span>{name === 'Reasoning level' && <button type="button" className="model-control-reset" aria-label="Reset model options" title="Reset model options" disabled={disabled} onClick={reset}><RotateCcw size={13}/></button>}</div>
    <div className={`model-control-choices ${compact ? 'model-control-context' : ''}`} role="group" aria-label={name}>{items.map(item => <button type="button" key={item.value} aria-pressed={selected === item.value} data-unavailable={!!item.disabled} disabled={disabled || item.disabled} onClick={() => change(item.value)}><span>{item.label}{item.isDefault && <em>Default</em>}{item.detail && <small>{item.detail}</small>}</span>{selected === item.value && <Check size={13}/>}</button>)}</div>
  </section>;
  return <div ref={controlsRef} className="model-controls" data-saving={saving} aria-busy={saving}>
    {choices('Reasoning level', cursor ? variant?.effort || '' : effort,
      (cursor ? values('effort') : ['', ...option?.efforts || []]).map(value => ({value, label:labelForEffort(value), isDefault: value === '', disabled: cursor && !available('effort', value)})),
      value => cursor ? changeVariant('effort', value) : onChange(model, value, settings))}
    {values('context').length > 1 && choices('Context length', variant?.context || '', values('context').map(value => ({value, label:value.toUpperCase() || 'Default', disabled:!available('context', value)})), value => changeVariant('context', value), true)}
    {!!option?.contextWindows?.length && choices('Context length', String(settings.contextWindow || ''), [{value:'', label:'Default'}, ...option.contextWindows.map(value => ({value:String(value), label:new Intl.NumberFormat('en', {notation:'compact'}).format(value)}))], value => onChange(model, effort, {...settings, contextWindow:Number(value) || undefined}), true)}
    {(option?.supportsFastMode || variants.some(item => item.fast)) && choices('Service tier', fastSelected ? 'fast' : 'standard', [
      {value:'standard', label:'Standard', isDefault:true, disabled:!option?.supportsFastMode && fastSelected && !fastVariant},
      {value:'fast', label:'Fast', detail:'Faster responses, higher usage', disabled:!option?.supportsFastMode && !fastSelected && !fastVariant},
    ], value => setFast(value === 'fast'))}
  </div>;
}
