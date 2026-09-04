OpenCode's `task` delegation carries no working-directory parameter. Run every command explicitly in the handed WORKTREE PATH and inspect `git -C <worktree path> diff <the named ref>`. Never substitute the current process directory.

Verdict vocabulary — `verdict: pass | fail | blocked`, exactly as shaped above. Your final message is the task result: this host's `task` delegation is synchronous and returns your final message in-band to the orchestrator that launched you, so the verdict above is what the orchestrator parses — it is data, never prose.
