# 0030 — The first-run preference round shrinks to two questions

Date: 2026-07-21
Status: accepted
Supersedes: ADR-0007 (the third preference field)
Superseded-by: ADR-0149 — retires only the "asked once, never re-asked" reading of the record as a whole. This round is unchanged at two questions and still runs at the first plan in a project; a SECOND round on a different trigger — the first AUTO or roadmap arming — fills the same record with the ceiling fields, and the self-heal this decision defines gains a sibling that migrates a legacy `scope: personal` copy in place instead of re-asking either round
Reconciled: applied — Mode 1 §0 asks two preference questions.
Source: docs/blueprint.md amendment of 2026-07-21 (repaso-categories-antiswallow), decision (D3), deciding commit 4cc2020

## Decision

The first-run preference round asks explanation depth and adaptive teaching only; the third field — the always/never/offer walkthrough gating toggle — is retired. Reading `oso/preferences` self-heals a stored observation that still carries the retired field through `mem_update` (merge, never overwrite), mirroring the `oso/index` self-heal.

## Context

The field was retired with the gate it fed (ADR-0031), so a stored observation carrying it describes a behavior that no longer exists.
