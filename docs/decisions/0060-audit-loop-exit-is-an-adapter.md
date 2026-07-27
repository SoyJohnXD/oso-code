# 0060 — The design-audit loop exits on an adapter over upstream, not a token

Date: 2026-07-25
Status: accepted
Reconciled: applied — Mode 1 §7 reads the translated exit bar and the named residual.
Source: docs/blueprint.md amendment of 2026-07-25 (c-mechanisms), decision (b), deciding commit 7d52356

## Decision

Impeccable emits no `clean`, so the bar TRANSLATES two fields of its report — the integrity verdict is `Pass` AND no P0 or P1 finding is open — and names those two fields as what moves when upstream changes shape. The operator escape (an explicitly accepted residual) stands BESIDE that bar, never in its place; a P2 or P3 still open when the loop ends is NAMED in the record of the mode that ran it, never dropped because the loop was allowed to end. Findings go to `oso-applier` as judge findings, and each round is proved by two things — the re-audit, and the project's own zero-warnings bar, which the ORCHESTRATOR runs because an `audit` judges design and runs no project checks, unlike `oso-code:debt-sweep`.

## Context

A loop worded around a token its emitter never says is a loop with no exit.
