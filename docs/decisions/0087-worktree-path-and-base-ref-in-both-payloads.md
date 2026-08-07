# 0087 — Both delegation payloads carry a worktree path and a base ref

Date: 2026-08-02
Status: accepted
Superseded-by: ADR-0118 — retires only the single BASE REF the ref coordinate named regardless of position; three named coordinates (CHANGE BASE, WAVE START, SLICE START) now split what that ref means by where the payload is built. The WORKTREE PATH pairing, the diff formula shape and the applier's skipped self-check under parallel all stand unchanged
Reconciled: applied — Mode 1 phase 6 names the two coordinates in both payloads.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

The `oso-applier` and `oso-verifier` payloads carry two coordinates in BOTH execution modes: the WORKTREE PATH the work lives in — the main checkout under sequential, that slice's own worktree under parallel, the merged main checkout at an integration gate — and the BASE REF the work is judged against. The verifier's "the diff" is thereby defined as `git -C <worktree path> diff <base ref>`. The applier skips its own self-check under parallel and reports `skipped: parallel`.

## Context

ADR-0063's closed list of four assignment kinds is untouched: the slice kind's payload gains two coordinates, not a fifth kind. "The diff" the verifier reads under ADR-0037 and ADR-0047 had never been defined — it was "whatever this tree happens to hold", which was one slice's work only while slices landed one after another on a single checkout, and which says nothing at all once a slice's own work is committed on a branch. The self-check goes because N project bars on one machine contend on ports, test databases, build caches and lockfiles that separate worktrees do not isolate, so the cheap check turns into flaky red; the verifier's run is the one that counts either way.
