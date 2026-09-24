/** Claude emits text deltas followed by a complete assistant snapshot.
 * Reconcile by message/block identity, never by text: repeated words are valid.
 */
export function createClaudeTextStream() {
  let blocks = new Map<number, string>();
  const completed = new Set<string>();
  let pendingBoundary = false;
  let hasText = false;
  function append(text: string) {
    if (!text) return '';
    const result = (hasText && pendingBoundary ? '\n\n' : '') + text;
    hasText = true;
    pendingBoundary = false;
    return result;
  }
  return (record: any): string => {
    if (!record || record.parent_tool_use_id) return '';
    if (record.type === 'stream_event') {
      const event = record.event;
      if (event?.type === 'message_start') {
        blocks = new Map();
        pendingBoundary = hasText;
      }
      if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const text = event.delta.text;
        if (typeof text !== 'string') return '';
        const index = event.index ?? 0;
        if (!blocks.has(index) && blocks.size) pendingBoundary = true;
        blocks.set(index, (blocks.get(index) || '') + text);
        return append(text);
      }
    }
    if (record.type === 'assistant') {
      const id = record.message?.id ?? record.uuid;
      if (id && completed.has(id)) return '';
      if (id) completed.add(id);
      let result = '';
      const content = Array.isArray(record.message?.content) ? record.message.content : [];
      for (const [index, block] of content.entries()) {
        if (block.type !== 'text' || typeof block.text !== 'string') continue;
        const streamed = blocks.get(index) || '';
        const missing = streamed && block.text.startsWith(streamed) ? block.text.slice(streamed.length) : streamed ? '' : block.text;
        if (!streamed) pendingBoundary = hasText;
        result += append(missing);
      }
      blocks = new Map();
      pendingBoundary = hasText;
      return result;
    }
    return '';
  };
}
