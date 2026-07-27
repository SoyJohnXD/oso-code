# 0031 — Repaso de cambios replaces the didactic walkthrough

Date: 2026-07-21
Status: accepted
Supersedes: ADR-0008 (the gated end-to-end walkthrough)
Reconciled: applied — Mode 1 §5 delivers the repaso, always, heading the plan argument.
Source: docs/blueprint.md amendment of 2026-07-21 (repaso-categories-antiswallow), decision (D4), deciding commit 4cc2020

## Decision

A fixed three-section brief — Qué se va a realizar / Decisiones del ledger que lo moldean / Cómo va a funcionar — under a ~20-line soft cap, written in the operator's language at their depth preference and never in a forced didactic register, HEADS the plan argument the native `ExitPlanMode` gate renders, immediately followed by the full plan detail: context, frozen ledger, every slice, verification bar.

## Context

The brief lives inside the gate's own argument because that is the surface the operator actually reads before approving.
