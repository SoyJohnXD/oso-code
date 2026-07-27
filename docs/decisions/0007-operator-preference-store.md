# 0007 — Operator preference store

Date: 2026-07-11
Status: accepted
Superseded-by: ADR-0030 — retires only the third preference field; the store, its topic key and its read/upsert discipline still stand
Reconciled: superseded — Mode 1 §0 asks the two questions ADR-0030 left, so the body deliberately reads otherwise on the third field.
Source: docs/blueprint.md amendment of 2026-07-11 (adaptive behavior), decision (a), deciding commit 577f972

## Decision

Operator preferences live in a single engram observation under topic key `oso/preferences` — one upserted observation, `type: preference`, `scope: personal` (honest per-machine: `$HOME`, not per-person) — holding three preferences: E2E walkthrough (always / never / offer each time), explanation depth (concise / standard / didactic), and adaptive teaching (auto-detect / always / off). It is asked once as one round in `/plan` step 0 on first run, read silently at every plan/quick start thereafter, and never re-asked; `/quick` consumes it but never asks; natural-language changes update it through `mem_update`, merging and never overwriting.

## Context

This amendment authorized syncing the named frozen bodies to it rather than filing a correction per body.

The v0.9.0 commit `4e565fa` edited this entry in place, deleting a phrase from decision (b), so `git blame` reports that commit rather than this one; `git log -S` on the original text recovers `577f972`.
