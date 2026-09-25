import type { LimitWindow, ProviderLimits } from '../shared/api';

type Parsed = Pick<ProviderLimits, 'plan' | 'windows' | 'notes' | 'warning'>;
const percent = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : undefined;
const plans: Record<string, string> = { free: 'Free', plus: 'Plus', pro: 'Pro', prolite: 'Pro Lite', max: 'Max', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu' };
const planName = (value: unknown) => typeof value === 'string' && value ? plans[value.toLowerCase()] || value : undefined;

function window(label: string, used: unknown, resetsAt: number | undefined): LimitWindow[] {
  const usedPercent = percent(used);
  return usedPercent === undefined ? [] : [{ label, usedPercent, ...(resetsAt && Number.isFinite(resetsAt) ? { resetsAt } : {}) }];
}

/** Claude `get_usage` control response body. */
export function parseClaudeLimits(response: any): Parsed {
  const plan = planName(response?.subscription_type);
  const limits = response?.rate_limits;
  if (!response?.rate_limits_available || !limits) return { plan, windows: [], notes: [], warning: 'Plan limits apply only to Claude subscriptions. API-key and cloud-provider sign-ins have no limits to show.' };
  const at = (row: any) => typeof row?.resets_at === 'string' ? Date.parse(row.resets_at) : undefined;
  const rows: [string, any][] = [['Current session (5-hour)', limits.five_hour], ['Weekly · all models', limits.seven_day], ['Weekly · Opus', limits.seven_day_opus], ['Weekly · Sonnet', limits.seven_day_sonnet], ['Weekly · OAuth apps', limits.seven_day_oauth_apps],
    ...(Array.isArray(limits.model_scoped) ? limits.model_scoped.map((row: any): [string, any] => [`Weekly · ${String(row?.display_name || 'Model').slice(0, 60)}`, row]) : [])];
  const windows = rows.flatMap(([label, row]) => window(label, row?.utilization, at(row)));
  const extra = limits.extra_usage;
  if (extra?.is_enabled) windows.push(...window('Extra usage · monthly', extra.utilization, undefined));
  return { plan, windows, notes: extra?.is_enabled ? ['Extra usage is on: requests continue past plan limits and are billed.'] : [] };
}

function codexWindowLabel(minutes: unknown) {
  if (minutes === 10080) return 'Weekly';
  if (minutes === 1440) return 'Daily';
  return typeof minutes === 'number' && minutes > 0 ? minutes % 60 ? `${minutes}-minute` : `${minutes / 60}-hour` : 'Usage';
}

/** Codex app-server `account/rateLimits/read` result. */
export function parseCodexLimits(response: any): Parsed {
  const byId = Object.values(response?.rateLimitsByLimitId || {}).filter(Boolean) as any[];
  const snapshots = byId.length ? byId : response?.rateLimits ? [response.rateLimits] : [];
  const windows: LimitWindow[] = [], notes: string[] = [];
  for (const snapshot of snapshots) {
    const bucket = snapshot.limitId && snapshot.limitId !== 'codex' ? `${String(snapshot.limitName || snapshot.limitId).slice(0, 60)} · ` : '';
    for (const row of [snapshot.primary, snapshot.secondary]) if (row) windows.push(...window(`${bucket}${codexWindowLabel(row.windowDurationMins)} limit`, row.usedPercent, typeof row.resetsAt === 'number' ? row.resetsAt * 1000 : undefined));
    const credits = snapshot.credits;
    if (credits?.unlimited) notes.push(`${bucket}Unlimited credits`);
    else if (credits?.hasCredits && credits.balance) notes.push(`${bucket}Credit balance: ${String(credits.balance).slice(0, 30)}`);
  }
  if (response?.ordinaryUsageAllowed === false) notes.unshift('Included usage is currently exhausted.');
  const resets = response?.rateLimitResetCredits?.availableCount;
  if (typeof resets === 'number' && resets > 0) notes.push(`${resets} free limit reset${resets === 1 ? '' : 's'} available (redeem in Codex).`);
  const plan = planName(snapshots.find(snapshot => snapshot.planType)?.planType);
  return { plan, windows, notes, ...(windows.length ? {} : { warning: 'Codex did not report any limits for this account.' }) };
}
