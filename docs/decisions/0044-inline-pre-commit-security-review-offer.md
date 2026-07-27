# 0044 — Pre-commit security-review offer, invoked inline

Date: 2026-07-22
Status: superseded
Superseded-by: ADR-0045 (the review moves into a fork and never runs inline)
Reconciled: superseded — Mode 1 §7, Mode 2 and Mode 3 §5 all read the forked skill instead.
Source: docs/blueprint.md amendment of 2026-07-22 (debug-security-flows), decision (D4), deciding commit e556769

## Decision

Before any commit, offer a security review: the native `security-review` skill through the Skill tool when it is listed, else a recommendation to type `/security-review`. Triggers are `/plan`'s security derived category and `/quick`'s data-models/auth/payments vocabulary.

## Context

Pre-commit because the native review reads the pending working-tree diff, which dies at commit — the one clause of this decision that outlived the mechanism and still governs where the offer sits.
