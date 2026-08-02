# 0039 — The diagnosis persists once, and never to the index

Date: 2026-07-22
Status: accepted
Implemented-in: plugin/skills/_shared/bodies/debug.md
Reconciled: applied — Mode 3 §3 carries the single save and the no-index rule.
Source: docs/blueprint.md amendment of 2026-07-22 (debug-security-flows), decision (D5), deciding commit e556769

## Decision

The frozen diagnosis persists ONCE to `oso/{bug}/diagnosis`, `type: architecture`, with no `oso/index` row.

## Context

The index tracks changes, not bugs, so a row there would make every triage look like work in flight.
