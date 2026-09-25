import { z } from 'zod';
import type { Plan, PlanStep, Thread } from '../shared/api';
import type { ProviderTool } from './delegation';

export function planSteps(items: unknown): PlanStep[] {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 100).flatMap(item => {
    const text = item?.step ?? item?.content ?? item?.text;
    if (typeof text !== 'string' || !text.trim()) return [];
    const status = String(item.status).replace('inProgress', 'in_progress');
    return [{ text: text.slice(0, 4000), status: ['in_progress', 'completed', 'cancelled'].includes(status) ? status as PlanStep['status'] : 'pending' }];
  });
}

export const planningInstructions = `Plan the work without implementing it. Explore the repository, ask clarifying questions, and produce a self-contained implementation brief for a fresh model that will not see this conversation. Include the goal, constraints, decisions, relevant files, ordered implementation steps, and validation criteria. Use numbered steps or markdown checkboxes. Save the complete brief with vulp_update_plan if available. Stop when the plan is ready; the user will start implementation separately.`;

export function planTool(save: (plan: Partial<Plan>) => Promise<void>): ProviderTool {
  return { name: 'vulp_update_plan', description: 'Save the implementation checklist and self-contained handoff brief. Update step statuses as work progresses; completed means implemented and verified. Include decisions, file paths, constraints and validation in the brief.', schema: {
    brief: z.string().max(100_000), steps: z.array(z.object({ text: z.string().min(1).max(4000), status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']) })).min(1).max(100),
  }, call: async args => { await save(args as unknown as Plan); return { saved: true }; } };
}

export function stepsFromMarkdown(text: string): PlanStep[] {
  return text.split('\n').flatMap(line => {
    const match = line.match(/^\s*(?:[-*]\s+\[([ xX])\]|\d+[.)])\s+(.+)/);
    return match ? [{ text: match[2], status: match[1]?.toLowerCase() === 'x' ? 'completed' as const : 'pending' as const }] : [];
  }).slice(0, 100);
}

export function handoffBrief(thread: Thread, workspace: string) {
  if (!thread.plan?.brief.trim()) throw new Error('A complete plan brief is required before handoff');
  return `Implement this saved plan in a fresh session. You do not have the planning conversation. Inspect the current workspace before making changes, preserve unrelated work, and keep the checklist updated with native plan/todo tools or vulp_update_plan. Verify completed work.\n\nWorkspace: ${workspace}\n\n${thread.plan.brief}\n\nChecklist:\n${thread.plan.steps.map(step => `- [${step.status === 'completed' ? 'x' : ' '}] ${step.text} (${step.status})`).join('\n')}`;
}
