# Conduit

A desktop workspace for Codex, Claude Code, Cursor, OpenCode, and GitHub Copilot. Projects and conversations live locally. Conduit discovers installed CLIs and runs them as subprocesses using their existing sign-in; it does not call model-provider APIs directly.

## Work in one place

- Project folders, persistent conversations, CLI session resume, and per-chat [Git workspaces](docs/chat-workspaces.md).
- Searchable project and model pickers with provider icons from icons0.dev.
- Per-model reasoning effort from capabilities advertised by the local CLI.
- Four [approval modes](docs/approval-modes.md), selectable between turns, with inline permission requests. A running process keeps its current permissions. Provider selection locks after the first message.
- Inline tools, public reasoning summaries, and delegated-agent activity when exposed by the CLI.
- [Claude ↔ Codex delegation](docs/cross-provider-delegation.md) for read-only review and research, with live child activity and results returned to the parent.
- Copy response, native text context menus, and project/thread context actions.
- Selected-file commits, branch push, and pull requests through Git and `gh`.

## GitHub Copilot CLI

Install the standalone `copilot` CLI on PATH and run `copilot login` (or configure a Copilot BYOK provider). Refresh discovery in Agent settings, then choose GitHub Copilot in the model picker. Conduit launches `copilot --acp --stdio` using the CLI's existing environment and credentials. ACP is currently a public preview; use a recent CLI version.

Responses, tool activity, permission prompts, image blocks, and session resume use ACP. Auto asks for permission when Copilot requests it; Auto accept edits approves edit requests only. Conduit resets Copilot's persisted `allow_all` setting to off when advertised and handles permission choices itself. Provider-level allowlists still apply. Models come from ACP session capabilities; if none are advertised, use CLI default or enter an exact model ID. Reasoning effort stays at the CLI default unless advertised support is available. Slash commands can be sent as messages; there is no Copilot command menu yet.

Validation: protocol fixtures cover discovery, model selection, resume, approvals, and cancellation. Local Copilot 1.0.88 completed ACP initialization and session creation, but a live model prompt returned an expired/invalid-credentials authorization error. Authenticated responses and vision remain unverified.

See [GitHub's ACP server reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server).

## Attachments

Use the paperclip, drop files onto the composer, or paste images. Up to 10 attachments, 20 MB per file, 5 MB per image, and 50 MB total. Copies are stored in the local app data directory, independent of the original file. Images receive thumbnails in the draft and conversation.

Codex uses `--image`, Claude uses image blocks over CLI stream-json stdin, and OpenCode uses `--file`. Cursor image input is not implemented and is rejected explicitly. Other documents are passed as local-file references for the agent to read; extraction depends on that CLI's tools and the selected model. Image understanding also requires a vision-capable model. Attachment adapters are covered by replay and unit tests. One live read-only Codex image prompt correctly identified the fox logo; authenticated Claude and OpenCode vision remain unverified.

## Install and update

Download the appropriate build from [GitHub Releases](https://github.com/jrmd/conduit/releases). On Linux, make the AppImage executable and run it. The unpacked development binary cannot self-update.

This repository is private. Sign in with `gh auth login` on the work machine using an account with access to `jrmd/conduit`. Conduit retrieves the credential from `gh` in its main process when checking for updates. No credential is bundled in a release, exposed to the renderer, or persisted by Conduit. GitHub access and local CLI access are separate.

Installed builds check 15 seconds after startup and every four hours, download available stable releases, then show **Restart to update**. Updates never restart the app automatically or while an agent is running. A manual check is available in Agent settings. Failed checks can be retried; an unpacked build explains that the AppImage is required.

## Development

Requires Node.js 22+, pnpm 11.22.0, and at least one supported CLI on PATH. `gh` is used for pull requests and private release updates.

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm package:linux
```

`pnpm package:win` builds an NSIS installer; `pnpm package:mac` builds a DMG and ZIP. Linux is the locally tested platform. Windows release builds are produced by GitHub Actions. macOS releases require signing/notarization credentials.

## Releases

Push the source to `main`; checks run automatically. To publish a version, update `package.json`, commit it, then push a matching `vX.Y.Z` tag. The release workflow builds Linux and Windows, uploads binaries and updater manifests, and publishes a GitHub Release only after builds succeed. `workflow_dispatch` builds artifacts without publishing unless invoked on a version tag.

For signed macOS releases, set repository variable `ENABLE_MAC_RELEASES=true` and secrets `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. These are not needed for Linux. Windows binaries are currently unsigned; managed enterprise installations may require a signing configuration. macOS auto-update requires a signed application.

## Data and compatibility

The Conduit rename preserves the legacy `j2code` user-data directory and internal IPC/environment names so existing conversations remain available. `J2CODE_DATA_DIR` isolates test data and disables update checks. Attachment copies are retained in that data directory; deleting a conversation does not currently prune copies.

Activity retains the last 500 entries per thread and up to 20 KB of detail per entry. Codex CLI JSON is supplemented by public events in the exact current session and explicitly linked child sessions. Raw hidden reasoning and unrelated session contents are not read. Other providers are limited to events their CLIs emit. Stopping a run stops its CLI process group and its Conduit-managed children. Conduit children can be cancelled individually by the parent; follow-up messaging and independent UI steering are not implemented.

## Credits

Fox artwork and the new-thread halftone shader supplied by the project owner (@jrmd / OpenShaders). The shader runs only on the new-thread page, respects reduced motion, pauses while hidden, and releases GPU resources when the conversation starts. Provider marks come from the Simple Icons collection via icons0.dev (CC0; source URLs in `src/icons/README.md`). Brand trademarks belong to their respective owners.

On macOS, `pnpm dev` creates a cached, ad-hoc-signed `Conduit.app` in `node_modules/.cache/conduit-electron`, with the Conduit Dock name, menu name, and supplied icon. It uses the installed Electron runtime and macOS system tools; the first launch takes a little longer. The cache rebuilds when Electron, the logo, or the launcher changes.

The existing `dev.jrmd.vulp` packaged application ID, `j2code` data directory, and `vulp.*` preference keys are retained for upgrade continuity. New packages and update checks use `jrmd/conduit`.
