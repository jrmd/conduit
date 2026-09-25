import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeLimits, parseCodexLimits } from './limits';

test('Claude limits map documented windows, per-model buckets and extra usage', () => {
  const parsed = parseClaudeLimits({ subscription_type: 'max', rate_limits_available: true, rate_limits: {
    five_hour: { utilization: 45, resets_at: '2026-09-25T17:09:59Z' }, seven_day: { utilization: 20, resets_at: '2026-09-30T10:59:59Z' },
    seven_day_opus: null, seven_day_sonnet: { utilization: null, resets_at: null },
    model_scoped: [{ display_name: 'Fable', utilization: 130, resets_at: null }], extra_usage: { is_enabled: true, utilization: 12 } } });
  assert.equal(parsed.plan, 'Max');
  assert.deepEqual(parsed.windows, [
    { label: 'Current session (5-hour)', usedPercent: 45, resetsAt: Date.parse('2026-09-25T17:09:59Z') },
    { label: 'Weekly · all models', usedPercent: 20, resetsAt: Date.parse('2026-09-30T10:59:59Z') },
    { label: 'Weekly · Fable', usedPercent: 100 },
    { label: 'Extra usage · monthly', usedPercent: 12 },
  ]);
  assert.equal(parsed.notes.length, 1);
  const apiKey = parseClaudeLimits({ subscription_type: null, rate_limits_available: false, rate_limits: null });
  assert.deepEqual(apiKey.windows, []);
  assert.match(apiKey.warning || '', /subscriptions/);
});

test('Codex limits use every metered bucket, label windows by duration and surface credits', () => {
  const window = (usedPercent: number, windowDurationMins: number) => ({ usedPercent, windowDurationMins, resetsAt: 1790454987 });
  const parsed = parseCodexLimits({ ordinaryUsageAllowed: false, rateLimits: { limitId: 'codex', primary: window(1, 300) },
    rateLimitsByLimitId: { codex: { limitId: 'codex', planType: 'prolite', primary: window(81, 300), secondary: window(40, 10080), credits: { hasCredits: true, unlimited: false, balance: '12.50' } }, spark: { limitId: 'spark', limitName: 'Spark', primary: window(5, 90) } },
    rateLimitResetCredits: { availableCount: 2 } });
  assert.equal(parsed.plan, 'Pro Lite');
  assert.deepEqual(parsed.windows.map(w => [w.label, w.usedPercent, w.resetsAt]), [['5-hour limit', 81, 1790454987000], ['Weekly limit', 40, 1790454987000], ['Spark · 90-minute limit', 5, 1790454987000]]);
  assert.deepEqual(parsed.notes, ['Included usage is currently exhausted.', 'Credit balance: 12.50', '2 free limit resets available (redeem in Codex).']);
  assert.match(parseCodexLimits({ rateLimits: { primary: null } }).warning || '', /did not report/);
});
