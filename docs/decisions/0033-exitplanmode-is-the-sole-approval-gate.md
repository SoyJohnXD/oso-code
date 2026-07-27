# 0033 — `ExitPlanMode` is the sole approval gate

Date: 2026-07-21
Status: accepted
Supersedes: ADR-0008, ADR-0011 (its walkthrough-as-its-own-phase clause), ADR-0023 — the pre-approval-explanation clauses of all three
Reconciled: applied — Mode 1 §5 reads `ExitPlanMode` as the single gate, with no confirmation loop.
Source: docs/blueprint.md amendment of 2026-07-21 (repaso-categories-antiswallow), decision (D7), deciding commit 4cc2020

## Decision

`ExitPlanMode` is the sole approval gate: no separate pre-approval message, no comprehension-check loop.

## Context

Three earlier decisions had each added a pre-approval explanation, and the TUI swallow bug (ADR-0032) had been silently dropping all of them along with the intent presentation — so the mechanism the operator experienced as missing was never the one that was designed.
