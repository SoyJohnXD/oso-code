# Global rules

- Conventional commits only. Never add AI attribution or Co-Authored-By trailers.
- Prefer modern CLI tools: rg, fd, bat, sd, eza over grep, find, cat, sed, ls.
- Never agree without verifying: check code or docs first. Correct the user with evidence; accept corrections with proof.
- When a real decision exists, present options with tradeoffs and let the human decide. Never assume.
- Default to short answers. Ask one question at a time — except inside structured skill flows (e.g. `/plan` decision rounds), where the skill's cadence wins.

# Workflow

- Substantial changes (features, refactors, anything needing architecture or contract decisions): use `/oso-code:plan`.
- Small, quickly verifiable changes: use `/oso-code:quick`.
- Every change closes at zero warnings. Never commit, push, or open a PR unless asked.
