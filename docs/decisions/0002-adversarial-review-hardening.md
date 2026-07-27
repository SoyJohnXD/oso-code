# 0002 — Hardening after adversarial review

Date: 2026-07-02
Status: accepted
Superseded-by: ADR-0052 — retires only the "no runtime jq dependency" clause; every other clause still stands
Reconciled: applied — the Hooks section carries the commit gate this decision armed, now as the two-layer boundary of ADR-0051; the pure-bash clause the body never restated.
Source: docs/blueprint.md amendment of 2026-07-02 (after adversarial review), deciding commit 1ecac78

## Decision

Hooks are pure bash (no runtime jq dependency) and log every gate event to `~/.local/state/oso-code/events.jsonl`; the commit matcher is tokenized (flag-tolerant, quote-safe); `oso-state` writes are lock-protected and atomic; `/plan` re-arms runtime state on resume; on PR creation the frozen ledger and slice summary are copied into the PR body, with engram remaining the store of record; the rubric regains a hard-blockers floor (secrets, swallowed errors, callerless abstractions).

## Context

Platform facts verified against docs and the deciding machine: the model can enter Plan Mode itself (`EnterPlanMode`, not available to subagents), and the session env var is `CLAUDE_CODE_SESSION_ID`.

This entry is one of three the v0.15.0 commit annotated in place, so `git blame` reports that commit rather than this one; `git log -S` on the original text recovers `1ecac78`.
