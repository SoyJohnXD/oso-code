# 0081 — A dedicated integrator merges the wave, and never judges it

Date: 2026-08-02
Status: accepted
Implemented-in: plugin/agents/oso-integrator.md, plugin/skills/plan/SKILL.md
Reconciled: applied — Mode 1 phase 6 names the integrator as the merger and the gate after it as the judge.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

A new `oso-integrator` agent merges ONE wave: the branches it was handed, one at a time, in the order the payload lists them, each named with `git -C`. It never resolves a conflict, never edits a source file to make a merge apply, never rewrites history and never pushes, and it JUDGES NOTHING — no rubric reaches it and nothing in its report says the merged tree is green. The orchestrator edits nothing during execution either.

## Context

ADR-0001's never-writes invariant is why this agent exists rather than the orchestrator merging: a merge produces file content nobody wrote, which is a write, so it is delegated like every other. That invariant is still narrowed exactly once, by ADR-0046's design-foundation slice — the git plumbing the wave loop leaves with the orchestrator (cutting and removing worktrees, staging and committing a green slice, the state writes) produces no file content. Judgment is withheld on purpose: the merged tree's bar belongs to the integration gate that follows (ADR-0082), and a merger that judged its own merge would be the author reviewing itself.
