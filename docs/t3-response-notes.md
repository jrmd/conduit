# T3 Code response rendering reference

Reviewed 2026-09-24 at upstream commit `b2b43bef73447c483ceae486890cb79f01c369cb` (MIT). This pass implements Vulp changes independently; no T3 source was copied.

- [ChatMarkdown](https://github.com/pingdotgg/t3code/blob/b2b43bef73447c483ceae486890cb79f01c369cb/apps/web/src/components/ChatMarkdown.tsx) uses ReactMarkdown/GFM, stable renderer components, memoization, code-block headers/copy, syntax highlighting and incremental parsing for streaming fences. Keeping component identity stable prevents streaming updates from recreating controls.
- [MessagesTimeline logic](https://github.com/pingdotgg/t3code/blob/b2b43bef73447c483ceae486890cb79f01c369cb/apps/web/src/components/chat/MessagesTimeline.logic.ts) groups activity by turn, preserves terminal assistant messages, and folds preceding work when a turn settles. It keeps live work visible and distinguishes terminal replies from intermediate commentary.
- [DesktopWindow](https://github.com/pingdotgg/t3code/blob/b2b43bef73447c483ceae486890cb79f01c369cb/apps/desktop/src/window/DesktopWindow.ts) uses Electron hiddenInset on macOS with traffic lights positioned in the application header.

## Applied in Vulp 0.3.3

Shared memoized Markdown rendering for streamed and stored replies, stable code-block controls with copy, more legible headings/lists/tables and neutral response labels. Existing public activity disclosure remains separate from the answer. The provider runner now retains repeated Claude token deltas, reconciles full snapshots by block/message identity and separates complete Codex message items with paragraph boundaries. These were concrete faults in Vulp, independently found during comparison.

Settings is a dedicated pane, the sidebar is compact and neutral, the installed version is supplied by Electron, and macOS uses hiddenInset plus draggable header regions and traffic-light clearance. The paperclip shares the lower composer row; selected files stay above the composer.

## Remaining differences and proof boundaries

Vulp still stores a single combined assistant response per run, rather than T3's full turn/message projection. This change does not import T3's timeline engine, syntax highlighter, file navigation, rich directives or remote connection system. It does not claim provider parity. Claude text reconciliation was verified with subprocess replay, not a new authenticated Claude run. Native Mac window behavior requires validation on macOS; only Linux packaging and renderer layout can be tested on this host.
