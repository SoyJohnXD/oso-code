# 0088 — The worktree lifecycle, and the `repo_path` key it runs on

Date: 2026-08-02
Status: accepted
Implemented-in: plugin/skills/plan/SKILL.md, plugin/hooks/cleanup-state.sh
Reconciled: applied — the Hooks section's per-session-file bullet names `repo_path` and the SessionEnd teardown, and Mode 1 phase 7 opens on clearing the trees and then the branches.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

A worktree is destroyed at its wave's integration, by the integrator. Survivors are removed at SessionEnd, and the ones an abandoned session left behind go out with ADR-0057's 7-day orphan pass. Every teardown is `git worktree remove` and then `git worktree prune`, never `rm -rf`, run in the repo named by a new `repo_path` key in the session's state file — and WORKTREES GO BEFORE BRANCHES, at the close as at SessionEnd.

## Context

Git refuses to delete a branch a standing worktree still has checked out, merged or not, and no force overrides that refusal, so the other order stops at its first step every time. The prune is the half `remove` cannot do: a directory deleted behind git's back stays registered in `.git/worktrees`, and the next `git worktree add` for that slice fails on a name only git still believes in. `repo_path` joins ADR-0003's per-session key=value file as its fourth key and is the teardown's only input — the SessionEnd hook runs in no working directory of the orchestrator's, so an absolute path is the only thing that can tell it where to prune. That teardown fails open, like the rest of that hook: an absent git, a repo that moved or a removal git refuses may not cost the session its state cleanup, so each one is recorded through ADR-0089's `event` verb rather than swallowed.
