# 0078 — Slices are cut by the vertical bar only, never by the execution mode

Date: 2026-08-02
Status: accepted
Reconciled: applied — Mode 1 phase 4 states the cut is by the vertical bar and the graph derived from it.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

The cut answers one question — does this slice deliver observable progress, and can it be verified on its own — and the dependency graph is DERIVED from the cut, never the cut from the graph. Cutting for parallelism is forbidden, in either execution mode.

## Context

The anti-erosion rule: parallelism pressure inverts the derivation and what comes out of it is the horizontal slice — "all the types", "all the tests", "all the endpoints" — disjoint in files, which is what makes them look parallel, and individually unverifiable, which is what makes them not slices. That trade loses both things §4 opens with: the vertical bar, and ADR-0037's per-slice automated check, which has no behavior of its own to fail on until its siblings land.
