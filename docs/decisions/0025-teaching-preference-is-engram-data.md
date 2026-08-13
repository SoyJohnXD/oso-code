# 0025 — The operator's teaching preference is engram data, not a repo default

Date: 2026-07-16
Status: accepted
Superseded-by: ADR-0149 — retires only the per-machine framing this decision's context rests on; the decision itself, that the preference is engram data and never a repo default, stands entire and holds more strongly at the per-project scope `mem_search` can actually retrieve
Reconciled: nowhere — it changed no file; the value lives in engram.
Source: docs/blueprint.md amendment of 2026-07-16 (windows-install-behavior), decision (D9), deciding commit 2905cde

## Decision

The operator's `teaching=always` preference is engram data, never a repo default.

## Context

A per-machine preference committed as a default would ship one operator's choice to the whole team.
