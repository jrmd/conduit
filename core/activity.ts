import type { ActivityUpdate, ProviderId } from '../shared/api';

const text = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
const status = (value: unknown): ActivityUpdate['status'] => /error|fail|declined/.test(String(value)) ? 'failed' : /completed|shutdown|success/.test(String(value)) ? 'completed' : /interrupt|cancel/.test(String(value)) ? 'interrupted' : /running|progress|pending/.test(String(value)) ? 'running' : 'unknown';

/** Per-run decoder: streamed blocks retain their identity and child output never becomes a root answer. */
export function createActivityParser(provider: ProviderId) {
  let sequence = 0;
  const blocks = new Map<string, { id: string; kind: ActivityUpdate['kind']; title: string; parentId?: string }>();
  const tools = new Map<string, { kind: ActivityUpdate['kind']; title: string; parentId?: string }>();
  const tasks = new Map<string, string>();
  const messages = new Map<string, string>();
  return (line: string): ActivityUpdate[] => {
    let value: any;
    try { value = JSON.parse(line); } catch { return []; }
    if (!value || typeof value !== 'object') return [];
    const rows: ActivityUpdate[] = [];
    const add = (id: string, kind: ActivityUpdate['kind'], title: string, detail: unknown, state: ActivityUpdate['status'], extra: Partial<ActivityUpdate> = {}) => rows.push({ id, kind, title, detail: text(detail), status: state, ...extra });
    if (provider === 'codex' && /^item\.(started|updated|completed)$/.test(value.type)) {
      const item = value.item || {};
      const id = text(item.id) || `item-${sequence++}`;
      const state = item.status ? status(item.status) : value.type === 'item.completed' ? 'completed' : 'running';
      if (item.type === 'reasoning') add(id, 'reasoning', 'Thinking', item.text, state);
      else if (item.type === 'command_execution') add(id, 'tool', item.command || 'Command', item.aggregated_output, state);
      else if (item.type === 'mcp_tool_call') add(id, 'tool', `${item.server || 'MCP'} · ${item.tool || 'Tool'}`, { arguments: item.arguments, result: item.result, error: item.error }, state);
      else if (item.type === 'file_change') add(id, 'tool', 'File changes', item.changes, state);
      else if (item.type === 'web_search') add(id, 'tool', 'Web search', item.query, state);
      else if (item.type === 'todo_list') add(id, 'status', 'Plan', item.items, state);
      else if (item.type === 'collab_tool_call') {
        add(id, 'tool', String(item.tool || 'Delegate').replaceAll('_', ' '), item.prompt, state);
        for (const agentId of new Set<string>([...(item.receiver_thread_ids || []), ...Object.keys(item.agents_states || {})])) {
          const agent = item.agents_states?.[agentId];
          add(`agent:${agentId}`, 'agent', `Agent ${agentId.slice(0, 8)}`, agent?.message || item.prompt || '', agent ? status(agent.status) : 'running', { agentId });
        }
      }
    }
    if (provider === 'claude') {
      const parentId = value.parent_tool_use_id ? `tool:${value.parent_tool_use_id}` : undefined;
      const streamKey = parentId || 'root';
      if (value.type === 'stream_event') {
        const ev = value.event || {};
        if (ev.type === 'message_start') messages.set(streamKey, ev.message?.id || `message-${sequence++}`);
        const key = `${streamKey}:${messages.get(streamKey) || 'message'}:${ev.index ?? 0}`;
        if (ev.type === 'content_block_start') {
          const block = ev.content_block || {};
          if (block.type === 'thinking' || block.type === 'tool_use') {
            const kind = block.type === 'thinking' ? 'reasoning' : /^(Agent|Task)$/.test(block.name) ? 'agent' : 'tool';
            const id = block.id ? `tool:${block.id}` : key;
            const title = block.type === 'thinking' ? 'Thinking' : block.name || 'Tool';
            blocks.set(key, { id, kind, title, parentId });
            if (block.id) tools.set(block.id, { kind, title, parentId });
            add(id, kind, title, block.thinking || '', 'running', { parentId });
          }
        } else if (ev.type === 'content_block_delta') {
          const block = blocks.get(key);
          if (block && (ev.delta?.thinking || ev.delta?.partial_json)) add(block.id, block.kind, block.title, ev.delta.thinking || ev.delta.partial_json, 'running', { parentId, append: true });
        } else if (ev.type === 'content_block_stop') {
          const block = blocks.get(key);
          if (block?.kind === 'reasoning') add(block.id, block.kind, block.title, '', 'completed', { parentId, append: true });
        }
      }
      if (value.type === 'assistant') for (const [index, block] of (Array.isArray(value.message?.content) ? value.message.content : []).entries()) {
        if (block.type === 'tool_use') {
          const kind = /^(Agent|Task)$/.test(block.name) ? 'agent' : 'tool';
          const title = block.input?.description || block.name || 'Tool';
          tools.set(block.id, { kind, title, parentId });
          add(`tool:${block.id}`, kind, title, block.input, 'running', { parentId, agentId: kind === 'agent' ? block.id : undefined });
        }
        if (block.type === 'thinking') { const existing = [...blocks.entries()].find(([key, entry]) => key.startsWith(`${streamKey}:${value.message?.id}:`) && entry.kind === 'reasoning'); add(existing?.[1].id || `${streamKey}:${value.message?.id || value.uuid}:${index}`, 'reasoning', 'Thinking', block.thinking, 'completed', { parentId }); }
        if (block.type === 'text' && parentId) add(`reply:${value.uuid || value.message?.id}:${index}`, 'status', 'Agent response', block.text, 'completed', { parentId });
      }
      if (value.type === 'user') for (const block of Array.isArray(value.message?.content) ? value.message.content : []) if (block.type === 'tool_result') {
        const previous = tools.get(block.tool_use_id);
        add(`tool:${block.tool_use_id}`, previous?.kind || 'tool', previous?.title || 'Tool result', `\nResult:\n${text(block.content)}`, block.is_error ? 'failed' : 'completed', { parentId: previous?.parentId || parentId, append: true });
      }
      if (value.type === 'system' && /^task_/.test(value.subtype || '')) {
        if (value.tool_use_id && value.task_id) tasks.set(value.task_id, value.tool_use_id);
        const toolId = value.tool_use_id || tasks.get(value.task_id) || value.task_id;
        const previous = tools.get(toolId);
        add(`tool:${toolId}`, 'agent', value.description || previous?.title || 'Subagent', value.summary || value.last_tool_name || '', value.subtype === 'task_notification' ? status(value.status) : 'running', { agentId: value.task_id, parentId: previous?.parentId || parentId, append: true });
      }
    }
    if (provider === 'opencode') {
      const part = value.part || {};
      const id = text(part.callID || part.id) || `event-${sequence++}`;
      if (value.type === 'reasoning') add(id, 'reasoning', 'Thinking', part.text, 'completed');
      if (value.type === 'tool_use' || value.type === 'tool') add(id, part.tool === 'task' ? 'agent' : 'tool', part.state?.input?.description || part.state?.input?.command || part.tool || 'Tool', { input: part.state?.input, output: part.state?.output, error: part.state?.error }, status(part.state?.status), { agentId: part.state?.metadata?.sessionId });
    }
    if (provider === 'cursor' && value.type === 'tool_call') {
      const call = value.tool_call || {};
      const name = Object.keys(call)[0] || 'Tool';
      add(value.call_id || `call-${sequence++}`, /task|agent/i.test(name) ? 'agent' : 'tool', name, call[name], value.subtype === 'completed' ? 'completed' : 'running');
    }
    return rows;
  };
}
