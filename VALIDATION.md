# Validation record

## 0.1.4 — compact controls, effort, and agent activity

Empty saved threads can change provider and access mode; the main process rejects cross-provider changes after the first user message or a captured session. The composer model picker is an anchored 340×320 maximum popout with vertical provider-icon tabs. Effort choices come from the selected model's local capabilities, reset on model/provider change, persist per thread, and are validated again before execution. Codex uses `model_reasoning_effort`, Claude uses `--effort`, and OpenCode uses `--variant`. Cursor/unknown models stay on Auto without guessed levels. The installed Claude CLI initialization handshake and OpenCode verbose listing were exercised without model prompts; only model/capability fields are returned to the renderer, never account identity.

Activity tracks reasoning summaries, tool input/output and statuses, Codex delegation lifecycle, Claude parent/child messages, OpenCode task results, and Cursor tool events. Codex's installed CLI omitted SubAgentActivity from stdout despite actual delegation. The fallback reads only matching session filenames and explicitly linked children, and accepts public item events from the current run. Tests cover exclusion of unrelated sessions, previous-turn content and raw reasoning payloads. Activity is bounded, persisted, and unfinished work is marked interrupted on restart/cancellation or status-not-reported when no terminal status is supplied.

`pnpm test`: **26/26 pass**. `pnpm typecheck` and Linux package build pass. `J2CODE_SMOKE_PACKAGED=1 node scripts/smoke-workspace-controls.mjs` passed against the final executable: empty-thread provider changes, first-message locking, per-model effort availability and backend rejection, reset/persistence, compact picker geometry, running/completed subagents through session-log fallback, tool output expansion, restart persistence, and cancellation. These app tests use labelled replay CLI subprocesses and isolated data. Screenshots: `compact-picker-014-1440.png`, `compact-picker-014-850.png`, and `agent-activity-014.png` in `artifacts/`.

Live Codex: the first benign read-only probe ran a shell printf and returned 437. A second bounded probe delegated 7×13. The local public session log showed `/root/calculate` running and completed, and its child session returned 91; the production log reader recovered those events (`artifacts/live-agent-session-014.json`). This confirms actual Codex delegation and decoding of its session output, alongside packaged replay validation. Claude/OpenCode/Cursor authenticated subagent activity remains unverified; OpenCode's CLI only publishes limited child detail. Independent child steering/cancellation is not implemented; Stop controls the parent CLI run.

Final AppImage SHA-256: `08f0bee2cb84482b450ca276d15e06d7ab218221846ec5c8ca4acb53402a3781`. Final app.asar SHA-256: `8dd0ee67c7751b42113685344d116812c1b03810c73ae195f104bda9bab6cc90`.

Protocol references: [Codex exec events](https://raw.githubusercontent.com/openai/codex/main/codex-rs/exec/src/exec_events.rs), [Claude stream events](https://code.claude.com/docs/en/agent-sdk/streaming-output), [OpenCode JSON runner](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/cli/cmd/run.ts). Installed CLI help and observed local capability frames take precedence over newer documentation where versions differ.

## 0.1.3 — model browser and provider settings

Added a larger model popover with provider groups, provider filters, search, and exact model IDs. New drafts can select provider and model together; existing sessions remain scoped to their original provider. Provider enable/disable preferences persist in the local store, with legacy stores defaulting to all enabled. Disabled providers cannot create threads, receive new prompts, or launch model discovery; existing chats and in-flight runs remain intact.

`pnpm test` passes 20/20 and typecheck passes. `scripts/smoke-provider-settings.mjs` checks settings persistence over app restart, legacy data migration, provider filtering, custom IDs, cross-provider draft selection, invalid IPC inputs, disabled-send enforcement, existing conversation retention, the all-disabled state, and model browser bounds at 1440×900 and 850×600. These UI checks send no provider prompts. The same smoke passed against the final Linux package. AppImage SHA-256: `c5fc784892141c6780bc4139686bd258fa2d6a72aad9a602af8ff69a057384af`; app.asar SHA-256: `09c02bc2d827c851292301d8eeb56bee9c398c9dea679cac19e7dd077eef85cf`.

## 0.1.2 — ordinary folders and simplified workspace

The installed Codex CLI reproduced the user's exact `Not inside a trusted directory` error using the application's invocation builder in a fresh non-Git folder. `node --import tsx scripts/check-codex-folder.mts` went red before the fix and green afterward. It uses an isolated Codex home and an offline localhost provider endpoint; passing means the real CLI emits `thread.started` and gets past the directory gate, not that an authenticated model response was tested. New and resumed invocations now include `--skip-git-repo-check`, preserving read-only/workspace-write sandbox settings. The invocation regression failed before the change and now passes.

The UI defaults Changes to closed, removes repeated conversation metadata and control labels, enlarges text, adds a dedicated New thread button, autosizes the composer, and dismisses provider/model menus on outside click or Escape. Markdown no longer preserves redundant whitespace between blocks. Errors display as an Agent stopped callout.

`pnpm test` passes 19/19; `pnpm typecheck` and the Linux package build pass. `J2CODE_SMOKE_PACKAGED=1 node scripts/capture-model-ui-fixture.mjs` passed on the final executable, checking model-menu dismissal, Changes open/close, new-thread focus and composer input. The 1440×900 and 850×600 screenshots use labelled fixture conversations, not live responses. No provider prompts were sent during this UI smoke. The AppImage SHA-256 is `46bcf78959b2f54e5f122d782cd170703abc7c841c6eafce3cbc73b1b623093b`; packaged `app.asar` SHA-256 is `4e31b6c350568304a69f184105f88e72e7a1d16f7d8077a6344a56fbbb32aacd`.


The Linux Electron app passed the Playwright smoke using an isolated `J2CODE_DATA_DIR` and a disposable Git repository. The only stubbed integration was Electron's native folder picker; all UI, IPC, persistence, local Git, and provider calls used their real application paths.

The smoke covered project selection, agent settings and CLI discovery, empty-thread persistence across app restart, a selected-file commit that left an unrelated pre-staged file staged, and the 1440×900, 850×600, and 430×850 layouts. It completed without renderer errors. Desktop and compact/mobile captures are in `artifacts/`.

Live Codex verification used the installed CLI and existing local authentication. Through the composer, the first prompt asked Codex to return a generated nonce without using tools or editing files. The next prompt asked it to recall that nonce without repeating it. Codex recalled it and both turns kept the same nonempty session id. No project files changed during either turn. This confirms local CLI authentication, one new session, and same-session resume; it does not validate Claude Code, OpenCode, Cursor, or remote push/PR flows.

Direct live checks also found the Claude CLI, but it returned an authentication-required response immediately. OpenCode was found but did not complete within a 50-second cap. Neither provider's authenticated chat or session resume was validated; no credentials or provider configuration were changed. Cursor CLI was not installed on this machine.

The final Linux unpacked executable from `release/linux-unpacked/j2code` passed the same smoke with isolated data. Its `resources/app.asar` SHA-256 is `4e967f3b77ca8ab829937a8bfa3b0973c7ae45ad00e359cc329967597076f518`; the AppImage SHA-256 is `aa12222a08f01b0d75daa9a1e90eab084c32d770364f5032c7597643e626c490`.

`pnpm test` passed all 14 core tests across Git, provider, and store behavior. `pnpm typecheck` passed. These are local Linux checks, not macOS or Windows validation.

## Reproduction

Run the full live Codex smoke from the project root:

```sh
J2CODE_SMOKE_PROVIDER=1 \
J2CODE_SMOKE_SCREENSHOT_PREFIX=/tmp/j2code-smoke \
node scripts/smoke-electron.mjs
```

The script runs `pnpm build`, creates and removes its temporary project and app data, and sends two short prompts through the locally authenticated Codex CLI.

Run only against an already-built Linux unpacked package:

```sh
J2CODE_SMOKE_SKIP_BUILD=1 \
J2CODE_SMOKE_PACKAGED=1 \
node scripts/smoke-electron.mjs
```

## Model picker follow-up (0.1.1)

The 0.1.0 live Codex nonce-recall proof above used the CLI default model and remains valid for new-session and same-session resume behavior. The 0.1.1 build adds model selection; its locally available Codex catalogue contained five listed choices when checked. In a disposable fixture, Playwright verified the CLI-default reset, selecting a discovered choice, entering an exact custom ID, keeping two threads' models separate, and preserving both selections across an app restart. No provider turns were used for those UI and persistence checks. Fixture screenshots are [desktop](artifacts/model-ui-fixture-1440.png) and [compact](artifacts/model-ui-fixture-850.png); they show seeded demo content and are not live provider conversations.

The final 0.1.1 Linux unpacked app passed a packaged launch/folder-picker/model-selector smoke with isolated app data. Its `resources/app.asar` SHA-256 is `2a8b79376801b1479b5b5582f2d867ffe9802cbbc75fa60c50caed88377d6876`; the AppImage SHA-256 is `3c4e765640c7ed4bde591436b125482b126d4401759f65bf1185f7657f8f06b1`. The packaged check verified the exact model-selector test ID after opening a disposable repository; it did not run a provider turn.

One authorized live model-specific Codex attempt used exact ID `gpt-6-sol` in read-only mode. The local CLI accepted the invocation, but the authenticated service returned HTTP 400: `The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.` No assistant reply or resumable session was produced, and no follow-up request was sent. The local catalogue did not list `gpt-6-sol` or `gpt-6-luna`; therefore model switching on a live resumed session remains unverified. Unit tests do verify that selected model IDs are forwarded on new and resumed invocations for all four CLI adapters.

After the model-picker work, `pnpm test` passed all 19 core tests (Git, provider invocation/catalogue/event parsing/process runner, and store). The screenshots are seeded fixture UI; the only live call in this follow-up was the rejected `gpt-6-sol` attempt above.

## Conversation flow refinement (0.1.5)

Typecheck, build, Linux AppImage packaging, and the packaged `scripts/smoke-workspace-controls.mjs` passed. The Electron check used isolated data and deterministic CLI subprocess fixtures, not new authenticated provider turns. It checked provider locking, effort validation and persistence, cancellation, input focus after selection, controls outside the writing field, and prompt/activity/answer ordering. The activity automatically expanded during execution and collapsed after completion.

Screenshots were visually inspected at 1440x900 and 850x600: [compact model picker](artifacts/compact-picker-015-850.png), [live inline activity](artifacts/activity-live-015.png), and [completed turn](artifacts/activity-complete-015.png). These are replay fixture conversations. macOS and Windows were not tested.

## Vulp redesign (0.2.0)

Renamed the desktop product, executable, title, and package to Vulp; retained the legacy user-data directory for existing workspaces. The supplied JPEG is preserved as the UI logo and converted to PNG for the application icon. Added a code-native landscape, new palette, and working prompt starters. Typecheck and Linux packaging passed. Packaged Electron replay checks passed at 1440x900 and 850x600, including the Vulp title, starter input, model and effort selection, provider locking, activity ordering, cancellation, and restart persistence. Screenshots: `artifacts/vulp-home-1440.png`, `artifacts/vulp-picker-850.png`, `artifacts/vulp-activity-complete.png`. No new authenticated provider runs or macOS/Windows checks were performed.

## Compact workspace controls (0.2.1)

Typecheck, Linux package, and packaged Electron replay smoke passed. New assertions cover switching between two projects before sending, sidebar context-menu opening/Escape dismissal, and native editable context-menu paste availability. Visually inspected the compact picker with the actual Simple Icons provider marks fetched from icons0.dev; source URLs and CC0 attribution are in src/icons/README.md. The wordmark and slogan are removed, logos are smaller, and the new-thread button has hover sheen. Provider runs remain replay fixtures.

## Workspace, attachments, and releases (0.3.0)

The read/edit regression was reproduced by a failing resumed-thread store test and fixed by separating provider locking from permission selection. 29 core tests and typecheck pass. Packaged Linux Electron replay smoke checks switching projects with the custom picker, native text context menus, image import/thumbnail/history persistence, copying exact assistant text through the native clipboard, permission changes between turns, disabled permission changes during runs, activity, and cancellation. Screenshots were inspected at 1440x900 and 850x600. CLI attachment argv/stream-json are covered for new and resumed turns; authenticated vision responses are not claimed.

GitHub release workflows build Linux AppImage and Windows NSIS plus updater manifests. macOS publishing is opt-in and requires signing/notarization secrets. Private GitHub updates use the signed-in gh CLI token only inside the main process, with no credential persisted or bundled. Installed AppImages check automatically; unpacked/test builds do not. Update installation is explicit and blocked while a run is active.

Live image proof: `VULP_LIVE_IMAGE_CHECK=1 node --import tsx scripts/check-live-image.mts` sent one read-only prompt through the production Codex runner with the managed PNG attachment. The CLI replied `Fox`. No tools were requested. Claude and OpenCode image input remain protocol-tested only. GitHub Checks passed on the initial source push.
