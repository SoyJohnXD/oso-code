# 0049 — Expand-contract slicing for wide refactors

Date: 2026-07-24
Status: accepted
Implemented-in: plugin/skills/plan/SKILL.md
Reconciled: applied — Mode 1 §4 offers the template on a contract change with many consumers.
Source: docs/blueprint.md amendment of 2026-07-24 (secfork-impeccable-pocock), decision (D9), deciding commit 7d52356

## Decision

`/plan` §4 gains an expand-contract slicing template — EXPAND, MIGRATE, CONTRACT — whose CONTRACT slice must verify a named pre-delete completeness check proving zero remaining consumers of the old form.

## Context

Adopted from the same mattpocock/skills gap analysis as ADR-0047.
