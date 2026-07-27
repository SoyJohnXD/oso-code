# 0011 — The walkthrough moves before approval, and one approval starts execution

Date: 2026-07-12
Status: accepted
Superseded-by: ADR-0033 — retires only the walkthrough-as-its-own-phase clause; the single approval gate and its save/index/state sequence still stand
Reconciled: applied — Mode 1 §5 carries the single approval gate and the save/index/state sequence.
Source: docs/blueprint.md amendment of 2026-07-12 (walkthrough-before-approval), joint marker (D1/D2), deciding commit 4e565fa

## Decision

The walkthrough is its own phase before approval, not between approval and execution: the slice plan is presented, the walkthrough explains it, then a single operator approval is the one gate that starts execution — the former separate "operator says ready" gate is gone. On that approval the plan saves, the `oso/index` row upserts to `executing`, and runtime state initializes.

## Context

Filed under one marker covering two numbers, and the entry never separates them: the phase order and the single gate are one decision about where approval sits, and the log cites them together everywhere, including in what supersedes them.
