# 0008 — Optional end-to-end walkthrough as `/plan` phase 5

Date: 2026-07-11
Status: superseded
Superseded-by: ADR-0031 (the repaso replaces the didactic walkthrough), ADR-0033 (`ExitPlanMode` is the sole approval gate)
Reconciled: superseded — Mode 1 §5 delivers the repaso with no gate, so the body deliberately reads otherwise.
Source: docs/blueprint.md amendment of 2026-07-11 (adaptive behavior), decision (b), deciding commit 577f972

## Decision

A new `/plan` phase 5 delivers the end-to-end narrative, the slice map, and the risks plus the frozen ledger decisions that shape the design, gated on the walkthrough preference (deliver / offer / skip). It explains and never reopens: a decision the operator wants to revisit goes back through the ledger like any blocked question.

## Context

The gate this decision introduced was retired with the preference field that fed it (ADR-0030), and the phase itself was replaced by the repaso de cambios.
