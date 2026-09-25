import type { ThreadUsage } from '../shared/api';
import './usage-meter.css';

const tokens = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function formatCost({ amount, currency }: NonNullable<ThreadUsage['cost']>) {
  const format = new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount > 0 && amount < 0.01 ? `<${format.format(0.01)}` : format.format(amount);
}

/** Context fill and session cost as last reported by the CLI; exact figures are in the tooltip. */
export function UsageMeter({ usage, onOpen }: { usage?: ThreadUsage; onOpen?: () => void }) {
  const { contextTokens, contextWindow, cost } = usage || {};
  const ratio = contextTokens !== undefined && contextWindow ? Math.min(1, contextTokens / contextWindow) : undefined;
  const context = contextTokens === undefined ? undefined : `${tokens.format(contextTokens)}${contextWindow ? ` / ${tokens.format(contextWindow)}` : ''} tokens`;
  const money = cost && formatCost(cost);
  const label = [context && `Context: ${context}`, money && `Session cost: ${money} (CLI estimate)`].filter(Boolean).join('\n');
  if (!label) return null;
  const Tag = onOpen ? 'button' : 'div';
  return <Tag className="usage-meter" type={onOpen ? 'button' : undefined} onClick={onOpen} data-level={ratio === undefined ? undefined : ratio >= 0.9 ? 'critical' : ratio >= 0.75 ? 'high' : undefined} title={onOpen ? `${label}\nClick for plan limits` : label} aria-label={label.replace('\n', ', ')} tabIndex={0}>
    {ratio !== undefined && <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" pathLength="100" /><circle cx="8" cy="8" r="6" pathLength="100" strokeDasharray={`${ratio * 100} 100`} /></svg>}
    <span>{ratio !== undefined ? `${Math.round(ratio * 100)}%` : context}</span>
    {money && <span className="usage-meter-cost">{money}</span>}
  </Tag>;
}
