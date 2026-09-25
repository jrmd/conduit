import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acpUsage, claudeUsage, codexUsage } from './usage';

test('Claude usage counts every input bucket for the main agent and takes window and cost from the result', () => {
  assert.deepEqual(claudeUsage({ type: 'assistant', parent_tool_use_id: null, message: { usage: { input_tokens: 10, cache_creation_input_tokens: 200, cache_read_input_tokens: 3000, output_tokens: 40 } } }), { contextTokens: 3250 });
  assert.equal(claudeUsage({ type: 'assistant', parent_tool_use_id: 'tool', message: { usage: { input_tokens: 10 } } }), undefined);
  assert.deepEqual(claudeUsage({ type: 'result', is_error: false, total_cost_usd: 0.42, modelUsage: { 'claude-haiku': { contextWindow: 200000 }, 'claude-opus[1m]': { contextWindow: 1000000 } } }), { contextWindow: 1000000, cost: { amount: 0.42, currency: 'USD' } });
  assert.equal(claudeUsage({ type: 'result', is_error: true, total_cost_usd: 0 }), undefined);
});

test('Codex and ACP usage map to context and optional cost', () => {
  assert.deepEqual(codexUsage({ tokenUsage: { last: { totalTokens: 5000 }, total: { totalTokens: 90000 }, modelContextWindow: 272000 } }), { contextTokens: 5000, contextWindow: 272000 });
  assert.deepEqual(codexUsage({ tokenUsage: { last: { totalTokens: 5000 }, modelContextWindow: null } }), { contextTokens: 5000 });
  assert.deepEqual(acpUsage({ sessionUpdate: 'usage_update', used: 1200, size: 128000, cost: { amount: 0.05, currency: 'EUR' } }), { contextTokens: 1200, contextWindow: 128000, cost: { amount: 0.05, currency: 'EUR' } });
  assert.deepEqual(acpUsage({ sessionUpdate: 'usage_update', used: 1200, size: 128000 }), { contextTokens: 1200, contextWindow: 128000 });
  assert.equal(acpUsage({ sessionUpdate: 'agent_message_chunk' }), undefined);
});
