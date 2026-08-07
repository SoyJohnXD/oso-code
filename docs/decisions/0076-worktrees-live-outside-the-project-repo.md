# 0076 — Parallel worktrees live outside the project repo

Date: 2026-08-02
Status: accepted
Superseded-by: ADR-0118 — retires only the "cut from the change's base ref" clause; every wave after the first cuts from WAVE START, the previous wave's own integration commit, instead. The worktree location, the per-slice branch naming and the integrator's teardown on a clean merge all stand unchanged
Reconciled: applied — Mode 1 phase 6 names the worktree location and the per-slice branch.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

A parallel slice runs in a linked worktree at `~/.local/state/oso-code/worktrees/<sanitized session>/<slice>` — never inside the project repo — cut from the change's base ref on its own branch `oso/<change>/<slice>`, one branch per slice. The integrator removes the worktree and deletes the branch when its wave merges clean (ADR-0088).

## Context

`docs/blueprint.md`'s Plan-state row ("Engram only — no files inside project repos") governs plan STATE, and this keeps it: the checkout lives under the same state directory the session flags do, outside every project the harness touches. What git itself writes into the repo — a `.git/worktrees/<name>` admin entry and a branch ref — is git's normal operation over a worktree, not harness state, and both are cleaned at the wave's integration or at the close. The session segment of the path is the sanitized id the hooks compute before they look, because a path spelled any other way is a path the teardown never finds.
