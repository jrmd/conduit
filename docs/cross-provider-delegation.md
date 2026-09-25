# Cross-provider delegation

Claude and Codex conversations can delegate read-only review/research tasks to installed, enabled Claude or Codex providers. Each child uses its provider's existing CLI sign-in. No separate API credentials are introduced.

For example: “Ask Codex to review the error handling in core/providers.ts, then use its findings in your answer.” The parent chooses when to delegate and may specify a child model. Omitted models use the child's CLI default, not the parent's model. Children appear as named agent rows in the activity feed, with nested tool activity and streamed output.

Start a **new Codex conversation** to use this feature. Codex App Server registers dynamic tools at thread creation and restores them on later resumes; conversations created before this feature do not acquire the tools on resume. Claude receives the Conduit MCP tools on both new and resumed conversations.

## Tools and lifetime

- `conduit_spawn_agent(provider, task, model?)` starts a child and returns its ID immediately.
- `conduit_wait_agent(agentId, timeoutMs?)` returns running or the child's terminal status, result and error. The default wait is 10 seconds, with a 30-second maximum; the parent can wait again. Results can be read repeatedly during the same turn.
- `conduit_cancel_agent(agentId)` stops an individual child.

Tools use the `mcp__conduit__` prefix in Claude. Their schemas are registered explicitly; Conduit does not parse delegation instructions out of assistant text.

Each parent turn permits three concurrent children and twelve child runs total. Each child has a ten-minute timeout. Parent completion, failure or cancellation stops remaining children. Children cannot invoke Conduit delegation. Task briefs are limited to 20,000 characters; results retain the last 20,000 characters and report `truncated: true` when shortened. The parent must collect results before its final answer.

Children receive an explicit task brief and the parent's working directory. They do not inherit conversation history, attachments, the parent's provider session, model or full-access permissions. Include relevant file paths and context in the brief. Their output and provider session IDs are stored as child activity, never as the parent's answer or session ID. Existing activity retention limits apply; child handles are not resumable across parent turns or app restarts.

## Restricted execution

Codex children run through App Server in its read-only sandbox with approvals denied, inherited MCP servers disabled, and native delegation, apps and browser/computer integrations disabled. Claude children receive only Read, Glob and Grep, with external MCP configuration and settings hooks disabled. Write, edit, shell and native delegation tools are unavailable. These restrictions deliberately limit this version to local review and research; unrestricted web research, parallel edits, worktree merging and follow-up messaging are outside this version.

The provider tool implementations and Codex sandbox enforce these restrictions; prompt instructions alone are not used as the access control. Root conversations retain their selected approval mode. Native provider subagents remain separate from Conduit-managed children.

## Implementation and verification

`core/delegation.ts` owns child lifetime, limits, scoped IDs, output and shared argument validation. `core/interactive-provider.ts` exposes it using Codex dynamic tools and Claude SDK in-process MCP tools. `electron/main.ts` supplies the installed/enabled providers and persists activity using the existing store.

Automated tests exercise result separation, cancellation, abandoned-child cleanup, foreign IDs, input validation, provider failures, Codex protocol dispatch and the actual Claude SDK MCP server over an in-memory MCP connection. These are deterministic transport tests, not model-backed proof.

Run `pnpm exec node --import tsx scripts/smoke-delegation.mts` for opt-in live round trips in both directions. It uses disposable marker files and requires the parent to return a marker obtained by its child. `--codex-child` tests the restricted Codex child alone. These tests consume CLI account usage.

Local verification on 2026-09-25: Codex 0.157.0 invoked the Conduit spawn tool and received a Claude child failure; Claude 2.1.282 reported its account session limit. A restricted Codex child successfully read and returned a marker. Successful model-backed Claude ↔ Codex round trips remain blocked by Claude account availability.

Provider references: [Codex App Server dynamic tools](https://learn.chatgpt.com/docs/app-server), [Claude SDK custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools). Codex dynamic tools are experimental; incompatible CLI versions report an error rather than silently falling back to shell-based delegation.
