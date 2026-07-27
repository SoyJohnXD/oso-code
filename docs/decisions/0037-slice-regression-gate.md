# 0037 — Slice regression gate

Date: 2026-07-21
Status: accepted
Reconciled: applied — Mode 1 §4 carries the failing-check-or-`Verify-exception` bar and §6 the verifier's diff reading.
Source: docs/blueprint.md amendment of 2026-07-21 (osmani-hardening), decision (D3), deciding commit d51ad79

## Decision

`/plan` §4's Verify bullet requires at least one automated check that fails without the slice — new or extended by the slice, exercising its behavior — or a declared `Verify-exception: <reason>` visible in the approval document. `oso-verifier` judges it by reading the diff, under an explicit no-time-travel prohibition.

## Context

ADR-0068 later carries the same shape into `/debug`, where the diagnosis's fix-criteria line is what records the token; ADR-0047 adds a quality bar on the check itself.
