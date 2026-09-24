import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeTextStream } from './response-stream';

const delta = (text: string, index = 0) => ({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } } });
const start = { type: 'stream_event', event: { type: 'message_start' } };
const snapshot = (id: string, text: string) => ({ type: 'assistant', message: { id, content: [{ type: 'text', text }] } });

it('preserves repeated Claude tokens and consumes the final snapshot only once', () => {
  const text = createClaudeTextStream();
  const output = [start, delta('go'), delta(' '), delta('go'), delta(' '), delta('go'), snapshot('a', 'go go go'), snapshot('a', 'go go go')].map(text).join('');
  assert.equal(output, 'go go go');
});

it('preserves identical text in separate messages and fills a missing snapshot suffix', () => {
  const text = createClaudeTextStream();
  assert.equal([start, delta('Done'), snapshot('a', 'Done.'), start, delta('Done'), snapshot('b', 'Done.')].map(text).join(''), 'Done.\n\nDone.');
});

it('reconciles separate text blocks around tools without duplicating them', () => {
  const text = createClaudeTextStream();
  const final = { type: 'assistant', message: { id: 'a', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', name: 'Read' }, { type: 'text', text: 'Ready.' }] } };
  assert.equal([start, delta('Checking.'), delta('Ready.', 2), final].map(text).join(''), 'Checking.\n\nReady.');
});

it('handles snapshots without streaming and excludes forwarded child text', () => {
  const text = createClaudeTextStream();
  assert.equal([snapshot('a', 'Same'), { ...delta('Child'), parent_tool_use_id: 'tool-1' }, { ...snapshot('child', 'Child'), parent_tool_use_id: 'tool-1' }, snapshot('b', 'Same')].map(text).join(''), 'Same\n\nSame');
});
