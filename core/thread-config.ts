import type { ThreadConfig } from '../shared/api';
import { normalizeModelId, validateEffort, validateModelSettings } from './providers';

export async function validateThreadConfig(current: ThreadConfig, value: ThreadConfig): Promise<ThreadConfig> {
  const model = normalizeModelId(value.model);
  const sameModel = current.provider === value.provider && current.model === model;
  const effort = sameModel && current.effort === value.effort
    ? current.effort : await validateEffort(value.provider, model, value.effort);
  const settings = sameModel && current.contextWindow === value.contextWindow && current.fastMode === value.fastMode
    ? {contextWindow: current.contextWindow, fastMode: current.fastMode}
    : await validateModelSettings(value.provider, model, value);
  return {provider:value.provider, mode:value.mode, planning:value.planning === undefined ? current.planning : value.planning === true, model, effort, contextWindow:settings.contextWindow, fastMode:settings.fastMode};
}
