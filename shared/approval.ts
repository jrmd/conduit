import type { ApprovalMode, ThreadMode } from './api';
export const approvalModes: { id: ApprovalMode; label: string; description: string }[] = [
  { id: 'supervised', label: 'Supervised', description: 'Ask before edits and actions that need permission.' },
  { id: 'auto-edits', label: 'Auto accept edits', description: 'Accept file edits. Ask for other actions that need permission.' },
  { id: 'auto', label: 'Auto', description: 'Use provider review for routine actions when supported. Otherwise ask.' },
  { id: 'full-access', label: 'Full access', description: 'Allow tools without approval, with unrestricted access.' },
];
export function approvalMode(mode: ThreadMode): ApprovalMode { return mode === 'read' ? 'supervised' : mode === 'edit' ? 'auto-edits' : mode; }
export function isThreadMode(value: unknown): value is ThreadMode { return typeof value === 'string' && ['read','edit',...approvalModes.map(mode=>mode.id)].includes(value); }
