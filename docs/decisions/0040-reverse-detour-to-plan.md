# 0040 — Reverse detour from `/debug` to `/plan`

Date: 2026-07-22
Status: accepted
Implemented-in: plugin/skills/debug/SKILL.md
Reconciled: applied — Mode 3 §3 carries the detour and the diagnosis-as-intent handoff.
Source: docs/blueprint.md amendment of 2026-07-22 (debug-security-flows), decision (D6), deciding commit e556769

## Decision

When triage reveals the break is a design flaw needing architecture or contract decisions, `/debug` offers `oso-code:plan`. The operator decides, and on acceptance the diagnosis travels as intent input.

## Context

The mirror of the bug detour ADR-0042 puts on the two forward flows.
