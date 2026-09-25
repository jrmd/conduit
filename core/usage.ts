import type { ThreadUsage } from '../shared/api';

const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Omit unreported fields so a partial update never clears a previously reported value. */
function usage(contextTokens?: number, contextWindow?: number, amount?: number, currency?: unknown): ThreadUsage | undefined {
  const result: ThreadUsage = {
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(amount !== undefined ? { cost: { amount, currency: typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : 'USD' } } : {}),
  };
  return Object.keys(result).length ? result : undefined;
}

/** Main-agent responses report the context they occupy; the result reports the window and the session's running cost. */
export function claudeUsage(message: any): ThreadUsage | undefined {
  if (message?.type === 'assistant' && !message.parent_tool_use_id) {
    const u = message.message?.usage;
    const tokens = [u?.input_tokens, u?.cache_creation_input_tokens, u?.cache_read_input_tokens, u?.output_tokens].map(count);
    return tokens.some(value => value !== undefined) ? usage(tokens.reduce<number>((sum, value) => sum + (value || 0), 0)) : undefined;
  }
  if (message?.type === 'result' && !message.is_error) {
    // Auxiliary models appear alongside the main model; the main model has the largest window.
    const windows = Object.values(message.modelUsage || {}).map((row: any) => count(row?.contextWindow) || 0);
    return usage(undefined, windows.length ? Math.max(...windows) : undefined, count(message.total_cost_usd));
  }
  return undefined;
}

/** Codex app-server `thread/tokenUsage/updated`: the last request is what currently fills the window. */
export function codexUsage(params: any): ThreadUsage | undefined {
  return usage(count(params?.tokenUsage?.last?.totalTokens), count(params?.tokenUsage?.modelContextWindow));
}

/** ACP `usage_update` session update. */
export function acpUsage(update: any): ThreadUsage | undefined {
  if (update?.sessionUpdate !== 'usage_update') return undefined;
  return usage(count(update.used), count(update.size), count(update.cost?.amount), update.cost?.currency);
}
