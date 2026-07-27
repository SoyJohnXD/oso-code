# 0043 — Stop-the-line on unrelated breakage

Date: 2026-07-22
Status: accepted
Implemented-in: plugin/skills/plan/SKILL.md, plugin/skills/quick/SKILL.md
Reconciled: applied — Mode 1 §6 and Mode 2 carry it.
Source: docs/blueprint.md amendment of 2026-07-22 (debug-security-flows), decision (D7), deciding commit e556769

## Decision

Breakage unrelated to the active work, found mid-execution, is named and handed to `/debug` — never fixed in passing. Declining is recorded, and the work continues.

## Context

A drive-by fix inside a slice is work no ledger decided and no verify criterion covers.
