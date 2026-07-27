# 0055 — The audit trail

Date: 2026-07-25
Status: accepted
Reconciled: elsewhere — landed in plugin/hooks/; the frozen body never carried the telemetry.
Source: docs/blueprint.md amendment of 2026-07-25 (gates-hardening), decision (D8), deciding commit 7d52356

## Decision

The deny JSON is emitted BEFORE logging and logging is non-fatal; the ERR trap is SCOPED to the armed region; values are escaped; abnormal branches carry their own event types (`state-unreadable`, `payload-unparseable`, `jq-absent`, `residue-allowed`); an unwritable log falls back to stderr; and every line records the client handle a native install carries in its own path — empty where the client sets none — so the next platform drift is detectable.

## Context

Both hooks had been failing OPEN when telemetry could not be written: an unwritable `HOME` exited 1, which the docs define as non-blocking, so the tool proceeded.
