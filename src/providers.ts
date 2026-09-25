import type { ProviderId } from '../shared/api';
import { SimpleIconsOpenai } from './icons/openai';
import { SimpleIconsClaude } from './icons/claude';
import { SimpleIconsCursor } from './icons/cursor';
import { SimpleIconsGithubcopilot } from './icons/githubcopilot';
import { SimpleIconsOpencode } from './icons/opencode';

export const providerIds: ProviderId[] = ['codex', 'claude', 'cursor', 'opencode', 'copilot'];
export const providerNames: Record<ProviderId, string> = {
  codex: 'Codex', claude: 'Claude Code', cursor: 'Cursor', opencode: 'OpenCode', copilot: 'GitHub Copilot',
};
export const providerIcons = { codex: SimpleIconsOpenai, claude: SimpleIconsClaude, cursor: SimpleIconsCursor, opencode: SimpleIconsOpencode, copilot: SimpleIconsGithubcopilot };
