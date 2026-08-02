# 0085 — Commits land per slice, and the base ref must be real

Date: 2026-08-02
Status: accepted
Superseded-by: ADR-0093 — retires only the "always, with no operator question about it" clause, which becomes ON by default and off where the ledger's §3 Verification row says so; the rest still stands
Implemented-in: plugin/skills/plan/SKILL.md
Reconciled: applied — Mode 1 phase 6 reads the per-slice commit in both modes and phase 4 reads a base ref of `none` as sequential-only.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

A slice's work is committed when that slice goes green — in both execution modes, always, with no operator question about it. The change's BASE REF (§3) must therefore name a real ref: a base ref of `none` makes PARALLEL unavailable and leaves SEQUENTIAL running without those commits, because a worktree branches from something, and per-slice commits over no starting point would leave the close's two judges diffing an empty surface.

## Context

A commit per slice is what turns a green slice into something the harness can merge, re-verify at the integration gate and undo one slice at a time; an operator asked for it would be asked once per slice for the length of a change, which is ceremony over a step the flow has already gated on a verifier's `pass`. Both paths carry it: §6's green window (ADR-0086) commits each green slice on its own branch under PARALLEL, and step 4 commits it in the main checkout under SEQUENTIAL, inside the green that step already writes. The sequential half was filed here ahead of any file that implemented it — the shape ADR-0062's conformance axis reads as `Unimplemented` — and it reached the tree the way that finding demands, as its own slice with its own failing check rather than landing through a close, carrying the boundary shift that made room for it (ADR-0093): a commit is part of the flow, and the push and the PR are what the operator is still asked for.
