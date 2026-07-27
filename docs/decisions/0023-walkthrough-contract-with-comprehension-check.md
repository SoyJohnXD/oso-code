# 0023 — The `/plan` §5 walkthrough is a contract

Date: 2026-07-16
Status: superseded
Superseded-by: ADR-0033 (`ExitPlanMode` is the sole approval gate, with no pre-approval message and no comprehension loop)
Reconciled: superseded — Mode 1 §5 follows the later decision; this entry's own commit changed no body line.
Source: docs/blueprint.md amendment of 2026-07-16 (windows-install-behavior), marker (D6-D8), deciding commit 2905cde

## Decision

A standalone didactic MESSAGE before approval, then an `AskUserQuestion` comprehension check with a review loop that never reopens decisions, and only then `ExitPlanMode`. Walkthrough content inside the `ExitPlanMode` argument is hard-banned.

## Context

Filed under the marker (D6-D8) together with ADR-0024, which the entry states as its own sentence on its own subject; this half is what ADR-0033 names as retired, and the other half still stands, which is why the two are separate here.
