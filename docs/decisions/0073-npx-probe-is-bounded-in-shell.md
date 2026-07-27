# 0073 — The npx probe is bounded in-shell at 20 seconds

Date: 2026-07-25
Status: accepted
Supersedes: ADR-0046 (its unbounded `npx impeccable --version` check), ADR-0059 (its unbounded resolve step)
Reconciled: applied — Bootstrap responsibilities item 2 reads the CLI check behind a 20-second in-shell bound.
Source: this change (harness-hardening pass); recorded with the change that made it

## Decision

Both places that run `npx impeccable --version` — `bootstrap/verify.sh` and the pin recipe in `plugin/skills/_shared/front-surface.md` — bound it at 20 seconds in-shell: background the probe under `set -m` inside a subshell, poll it, and kill its process group when the bound expires. A bound that fires is SLOW, never unresolvable: the recipe re-runs once, and if it fires again it tells the operator the registry is not answering and that re-running the mode resolves the pin — never taking the exception for it. Only npx failing on its own — no Node, no such package, a registry error it reports — is an unresolvable pin.

## Context

npx fetches from the registry before it can run anything, so an unreachable one hangs with no bound at all and every check below it never runs. `timeout(1)` is GNU coreutils that macOS does not ship, so the bound cannot be delegated to it. Job control is what puts the job in its own process group, so the kill reaches the node children npx spawns instead of orphaning them, and the subshell is what keeps that setting out of the rest of the session. Collapsing slow into unresolvable would turn a slow registry into a silently skipped design gate.
