# Thread titles and composer references

The first accepted message starts an independent CLI title request. Settings → Thread titles chooses its provider/model; the default uses the conversation model. Titles use at most six words and 48 characters. Failures keep the provisional title. Later messages do not regenerate it; the thread menu offers Regenerate title.

Type `@` to search project files, or `/` (also `$`) for skills and enabled plugins. Arrow keys navigate, Enter/Tab select, and Escape dismisses. Selected references are validated again before sending. The displayed message keeps only the readable tokens; the CLI prompt receives the resolved file/skill paths. No files are uploaded to a provider API by Vulp.

File discovery uses git tracked/untracked files with ignore rules, falling back to ripgrep outside Git. External symlinks are excluded. Discovery is capped at 12,000 files, returns 40 matching suggestions, and caches for 15 seconds.

Skills are read from the selected provider’s project and user directories. Entries marked user-invocable: false are hidden. Enabled Codex and Claude plugins are discovered with `plugin list --json`; their skill folders are included. Cursor and OpenCode expose local skills here, with a notice that plugin catalogue support is unavailable. This picker does not install plugins or manage authentication. Provider-specific skill policy overrides beyond frontmatter are not currently reflected in the catalogue; the CLI still applies its own runtime policies.

Sources used for directory conventions:
- [Codex skills](https://learn.chatgpt.com/docs/build-skills)
- [Claude skills](https://code.claude.com/docs/en/skills)
- [Cursor skills](https://cursor.com/docs/skills)
- [OpenCode skills](https://opencode.ai/docs/skills/)

Validation: core tests cover file ignores, path quoting, external symlinks, local skill visibility and title limits. `scripts/smoke-composer.mjs` exercises real Electron IPC and keyboard interactions with fixture CLI outputs, including automatic titles and prompt reference expansion. Live Codex catalogue discovery was verified separately; authenticated model responses and plugin execution were not tested.

UI tests can run on a virtual X display with `DISPLAY=:97`, `WAYLAND_DISPLAY` unset, and an Xvfb server. The composer test forces Electron to X11. Set `J2CODE_SMOKE_PACKAGED=1` to test the packaged Linux application. Do not run visible desktop tests while the user is gaming.
