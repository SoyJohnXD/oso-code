# 0009 — Gap-evidence adaptive teaching

Date: 2026-07-11
Status: accepted
Reconciled: elsewhere — landed in the skills, the global rules and the output style; the frozen body never carried it.
Source: docs/blueprint.md amendment of 2026-07-11 (adaptive behavior), decision (c), deciding commit 577f972

## Decision

When a request shows a knowledge gap — it contradicts current standard practice, or the operator cannot say what the ask involves — the flow briefly explains the terrain and recommends the standard path with the why before executing. The depth lands in `/plan` Intent and `/quick` Micro-intent, the trigger in the global rules, guarded so it never fires when the operator demonstrates knowledge.

## Context

Teaching, not gatekeeping: the guard is what keeps the trigger from reading as condescension.
