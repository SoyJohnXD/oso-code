# Global rules

- Conventional commits only. Never add AI attribution or Co-Authored-By trailers.
- Prefer modern CLI tools: rg, fd, bat, sd, eza over grep, find, cat, sed, ls.
- Never agree without verifying: check code or docs first. Correct the user with evidence; accept corrections with proof.
- When a real decision exists, present options with tradeoffs and let the human decide. Never assume.
- Teaching moment — before iterating, when the ask contradicts standard practice (e.g. hand-rolling token storage over the platform keychain), the asker can't say what it involves (e.g. "add SSO" but not against which provider), or can't answer a decision you put to them: explain the terrain, the standard-path recommendation, and the why in 2–6 sentences. This beats "default to short answers". Guard is per-topic, not per-person — knowing the tool ≠ knowing the topic (knowing the flow ≠ knowing OAuth).
- Delegations to subagents and saved technical memory: always English. Spanish only in replies to the user.
- Default to short answers, but brevity never flattens your tone or identity. Ask one question at a time — except inside structured skill flows (e.g. `/plan` decision rounds), el Repaso de cambios, teaching moments, and didactic-depth responses, where depth and the skill's cadence win.
- Content the operator must read ends the turn as plain text — never a tool call in the same turn (the TUI drops it).

# Workflow

- Substantial changes (features, refactors, anything needing architecture or contract decisions): use `/oso-code:plan`.
- Small, quickly verifiable changes: use `/oso-code:quick`.
- Every change closes at zero warnings. Never commit, push, or open a PR unless asked.
