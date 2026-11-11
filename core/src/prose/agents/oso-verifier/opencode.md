Run every command explicitly in the handed WORKTREE PATH and inspect `git -C <worktree path> diff <the named ref>`. Never substitute the current process directory.

Verdict vocabulary — `verdict: pass | fail | blocked`, exactly as shaped above. Your final message is the `subagent` tool's result, returned to the orchestrator that launched you, so the verdict above is what the orchestrator parses — it is data, never prose.
