# 0042 — The offers on `/plan` and `/quick` are additive only

Date: 2026-07-22
Status: accepted
Reconciled: applied — Mode 1 §1 and Mode 2's micro-intent carry the bug detour.
Source: docs/blueprint.md amendment of 2026-07-22 (debug-security-flows), decision (b) and (D9), deciding commit e556769

## Decision

The new offers on `/plan` and `/quick` are additive only: zero existing lines of the two flow SKILLs change. Operator constraint. The first of them is a bug detour at intent — an ask that turns out to be a break offers `/debug`, and the human decides.

## Context

The constraint is what kept a third mode from destabilizing the two flows already in daily use.
