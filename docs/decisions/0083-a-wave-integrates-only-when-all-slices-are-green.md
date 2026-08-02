# 0083 — A wave integrates only when all of its slices are green

Date: 2026-08-02
Status: accepted
Implemented-in: plugin/skills/_shared/bodies/plan.md
Reconciled: applied — Mode 1 phase 6 carries the all-green barrier.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

The all-green barrier: a wave reaches the integrator only when EVERY slice in it is green and committed. A red slice holds the wave — it loops apply → verify inside its own worktree while its green siblings wait, already committed — and no sibling's worktree is torn down while any slice of the wave is still working.

## Context

The integration gate (ADR-0082) judges a TREE, so a wave merged half-green would put its verdict over work no slice gate ever passed, and the failing-check re-run would be reading a slice that never went green in the first place. Waiting costs nothing but time, since the green siblings are already committed on their own branches. Their worktrees stay standing because that is where an operator can read what a slice actually did, and the integrator — which is handed each path — is what removes them (ADR-0088).
