# 0089 — `oso-state` gains an `event` verb

Date: 2026-08-02
Status: accepted
Superseded-by: ADR-0095 — retires only the `oso-state-unreachable` event, whose failure the teardown no longer has; the verb and every other line it writes still stand
Reconciled: elsewhere — landed in `plugin/bin/oso-state` and the SessionEnd hook; the frozen body names the state files but never the verbs that write them.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

`oso-state --session <id> event <type> [detail]` appends one line to the event log and touches no state file, taking no lock. The wave loop writes `worktree-created`, `merge-conflict` and `integration-red` through it; the SessionEnd teardown writes `worktree-removed`, `worktree-teardown-failed`, `worktree-prune-failed` and `oso-state-unreachable`.

## Context

ADR-0055's audit trail is written by the hooks over tool calls and by `oso-state` over state writes, and the branches this change adds are neither: cutting a worktree, stopping on a merge conflict and a red integration gate are events no gate ever sees, so nothing in the harness could have recorded them. No lock, unlike `set` and `clear`: that lock serializes publication of one session's state file, while this appends a line to the log every hook already appends to unlocked.
