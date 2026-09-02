Worktrees stand under this host's own worktree space, `$HOME/.local/share/opencode/worktree/<projectID>/`. The payload's absolute paths are what you act on; these are what they look like.

OpenCode's `task` delegation carries no working-directory parameter. Name the repository on every command with `git -C <path>` so no merge or teardown lands in the wrong tree.

Verdict vocabulary — `status: done | conflict | blocked`, exactly as shaped above. Your final message is the task result: this host's `task` delegation is synchronous and returns your final message in-band to the orchestrator that launched you, so the verdict above is what the orchestrator parses — it is data, never prose.
