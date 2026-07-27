# 0064 — `front-surface.md` is single-source only over what it holds

Date: 2026-07-25
Status: accepted
Supersedes: ADR-0046 (its claim that the integration contract lives once in that file)
Reconciled: applied — the body points at `plugin/skills/_shared/front-surface.md` for the trigger, the pin recipe and the exit bar, and at each mode for its own wiring.
Source: docs/blueprint.md amendment of 2026-07-25 (c-mechanisms), decision (f), deciding commit 7d52356

## Decision

`front-surface.md` claims single-source status only over what it actually HOLDS — the trigger, the pin recipe, the audit exit bar and the absence policy — while the WIRING is each mode's own: the integration contract is a per-mode matrix (five points by three modes) whose every cell is a POINTER, the mode's section plus what happens there, so the detail is read in the mode file and a row read across shows where the modes diverge.

## Context

A shared file that restates each mode's wiring becomes a second source that drifts from the first.
