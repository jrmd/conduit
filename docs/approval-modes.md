# Approval modes

The composer offers Supervised (the new-thread default), Auto accept edits, Auto, and Full access. The choice is stored per conversation and can change between turns. Existing `read` and `edit` records remain readable and are displayed as Supervised and Auto accept edits respectively. Supervised can now approve a requested edit; it is not a permanently read-only mode.

| Mode | Codex app-server | Claude Agent SDK | Cursor / OpenCode / Copilot ACP |
| --- | --- | --- | --- |
| Supervised | Read-only sandbox, untrusted commands, user reviewer | default permission mode | Display permission requests |
| Auto accept edits | Workspace-write sandbox, untrusted commands, user reviewer | acceptEdits | Accept requests classified as file edits; ask otherwise |
| Auto | Workspace-write, on-request, native auto_review | native auto mode | Ask; no heuristic command allowlist or blanket approval |
| Full access | danger-full-access, never | bypassPermissions | Allow permission requests; Cursor also uses force and disables its sandbox |

Provider-enforced deny rules and administrator restrictions can still prevent actions. Existing provider allowlists may permit operations without a prompt. Native Auto availability depends on the installed CLI and account policy; a provider rejection is reported, never retried with Full access. OpenCode receives a per-process permission policy that asks for tools while allowing normal reads/searches. Global provider configuration files are not modified.

Requests appear inline with their command, file changes or tool arguments. Responses apply once. Pending decisions are held in the main process, tied to the owning conversation, included in snapshots for renderer reload, and removed when the run ends or is cancelled. Unknown protocol requests are rejected rather than accepted. User question/form elicitation is separate from tool approval and is not implemented by this change.

Provider transports preserve session IDs, model choices, images, document references, and streamed responses. OpenCode config options are refreshed after model selection before applying effort. If an older ACP interface cannot set the requested effort or resume the session, it reports that limitation rather than silently dropping the setting or starting a different conversation.

## Verification

- Live installed Codex 0.156.1, Claude 2.1.282, and OpenCode: Supervised file creation paused, called the approval handler, and created the file only after acceptance in temporary directories.
- Live Codex initialization confirmed all four effective sandbox, approval-policy, and reviewer combinations, including native auto_review. This is configuration proof, not a claim about the automatic reviewer classifying every risk correctly.
- Cursor is not installed here. Its transport is covered by protocol fixtures, not authenticated live execution.
- Unit tests exercise thread ownership, stale decisions, abort cleanup, mode mapping, resumed ACP/Codex sessions, Auto fallback, and edit-only auto-acceptance.
- `scripts/smoke-approvals.mjs` exercises the built Electron renderer and real IPC against a deterministic provider fixture: four persisted choices, approve, deny, cancel, reload while waiting, mode changes blocked during runs, and narrow-screen layout.
- `scripts/smoke-quiet-focus.mjs` checks adjacent app journeys and new-thread layering. The 0.6.0 release checks also exercise the packaged Linux application; see [the validation record](../VALIDATION.md).

## Protocol references

- [Codex app-server](https://learn.chatgpt.com/docs/app-server); installed CLI-generated v2 protocol types confirm `approvalsReviewer: auto_review`.
- [Claude permission modes](https://code.claude.com/docs/en/permissions) and [SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions).
- [Cursor ACP](https://cursor.com/docs/cli/acp) and [CLI parameters](https://cursor.com/docs/cli/reference/parameters).
- [ACP permission requests](https://agentclientprotocol.com/protocol/v1/tool-calls).
- [OpenCode permissions](https://opencode.ai/docs/permissions/) and [ACP service](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/acp/service.ts).
