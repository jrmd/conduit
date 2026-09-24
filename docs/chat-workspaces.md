# Chat workspaces

The composer footer chooses a workspace before the first message:

- **Current checkout** uses the project directory. Pick an existing local branch, or enter a new branch name. Switching refuses dirty checkouts and active runs; it never stashes or discards changes.
- **New worktree** creates a separate checkout and a new named branch from the selected local branch (or current HEAD). Uncommitted changes stay in the original checkout. A committed base is required.

Setup happens when sending the first message. The thread stores its workspace path across restarts. Agent runs, file references, diffs, commits, pushes, and PR operations use that path. Existing threads keep their working directory; start a new thread to choose another. Local threads share the project checkout and therefore observe subsequent branch switches there.

Worktrees live under the application data directory in `worktrees/`. Deleting a thread or removing a project does not delete the worktree or branch; user changes remain on disk. Git can manage their later removal. Remote-only branch discovery and automatic worktree cleanup are not included.

Validation: `pnpm typecheck`, `pnpm test`, `pnpm build`, and `node scripts/smoke-workspaces.mjs`. The smoke test uses real Electron IPC and temporary Git repositories with a fixture provider, including checking the provider working directory. It does not call a live model service.
