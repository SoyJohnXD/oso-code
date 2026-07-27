# 0015 — `/plan` step 0 self-heals stale `executing` index rows

Date: 2026-07-12
Status: accepted
Reconciled: elsewhere — landed in plugin/skills/plan/SKILL.md; the frozen body names the recall but never the self-heal.
Source: docs/blueprint.md amendment of 2026-07-12 (walkthrough-before-approval), decision (D7), deciding commit 4e565fa

## Decision

`/plan` step 0 reconciles a stale `executing` `oso/index` row against plan and summary evidence and corrects it through `mem_update` (merge, never overwrite), under an executing-only guard.

## Context

A change that ended without a Close leaves its row claiming work that is not running.
