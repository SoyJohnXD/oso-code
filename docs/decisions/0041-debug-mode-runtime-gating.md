# 0041 — `mode=debug` edits are unrestricted; the commit gate is not

Date: 2026-07-22
Status: accepted
Reconciled: applied — Mode 3's opening line and the Hooks section carry it.
Source: docs/blueprint.md amendment of 2026-07-22 (debug-security-flows), decision (D1), deciding commit e556769

## Decision

The fix arms `mode=debug`, whose edits are unrestricted — the edit hook fires only on `mode=plan` — while the commit gate stays mode-agnostic and red until verify is green. Two new `tests/hooks-test.sh` assertions pin it, with the hooks themselves untouched.

## Context

A triage has no slices to activate, so a slice-scoped edit gate would deny every fix.
