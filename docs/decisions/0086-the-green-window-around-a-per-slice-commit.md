# 0086 — The green window around a per-slice commit

Date: 2026-08-02
Status: accepted
Implemented-in: plugin/skills/plan/SKILL.md
Reconciled: applied — Mode 1 phase 6 reads the per-slice commit inside a window the orchestrator opens and closes; the Hooks section's first bullet still reads the two layers, unchanged.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

A slice of a wave commits inside a GREEN WINDOW: `verify_green=true`, the slice's `git add -A` and `git commit` in its own worktree, then `verify_green=false` re-arming the wave — three commands with nothing between them, one slice at a time. No hook changes, and while the window is open the commit rail is open SESSION-WIDE: any commit, from any tree, in that turn, clears both layers.

## Context

Both layers of ADR-0051's rail read ONE session-global `verify_green` and neither can see which worktree a commit came from — the git `pre-commit` hook because `core.hooksPath` is an absolute path every linked worktree inherits, which leaves it reading the session's state file rather than the tree it fired in, and the `PreToolUse` matcher because it reads the command line and nothing else. A wave in flight is red until its last slice passes, so a per-slice commit (ADR-0085) is impossible unless the orchestrator opens the window, and the window is what buys it without touching a hook — ADR-0054's polarity and the flag both layers read stay exactly as they are. What it costs is an accidental-bypass window the harness accepts deliberately, and the only thing that pays for it is keeping it as short as those three commands allow — no verifier, no applier, no operator question, no second slice's commit inside one opening.
