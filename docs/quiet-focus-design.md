# Quiet focus

Approved direction: a quiet conversation surface, compact project/thread sidebar, and an on-demand file review panel. Preserve the supplied WebGL shader on new-thread and open-project screens, including its reduced-motion and context-loss behavior.

The throwaway comparison sketches are retained on local branch `codex/quiet-focus-sketch` (commit `ee2a79de1a73381ec603ead2e569a5e0cb4a2066`). Run `pnpm sketch` in that checkout to revisit them. The application entry point no longer contains a prototype switch.

The real review panel uses Git file status and diffs, selected-file commit actions, and an Activity view fed by the current thread. It does not infer test success from sample content. Existing model, provider, permission, attachment, thread and Git workflows remain connected to their original handlers.

## Validation

- `pnpm typecheck`, `pnpm build`, and all 38 core tests passed.
- Electron appearance checks passed, including an active WebGL program, light/dark uniforms, reduced motion, and persisted appearance.
- Electron Git action and thread-feature smoke checks passed. GitHub and title-generation results in the thread check use CLI fixtures.
- `node scripts/smoke-quiet-focus.mjs` passed against an isolated real Git repository: diffs, file selection across review tabs, draft preservation, empty activity, new-thread composer, and 1440/850/430 layouts. Message and activity content are fixtures.
- The live `smoke-model-picker.mjs` passed selection/persistence and reached both provider turns, but failed exact nonce recall: the second response returned only the nonce suffix. The full live smoke is not counted as passing. Stale thread locators and the old default-model label were updated in this script.
- The legacy `smoke-model-selector.mjs` targets the obsolete `release/linux-unpacked/j2code` executable and could not run. No packaged-release validation is claimed.

Settings now uses distinct accessible tab panels with arrow/Home/End navigation. The new-thread heading and project label sit on the opaque composer; decorative starter prompts are removed while WebGL remains active behind it.

This is a local source implementation; no release has been published.
