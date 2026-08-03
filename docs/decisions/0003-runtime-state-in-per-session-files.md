# 0003 — Runtime state lives in per-session flat files

Date: 2026-07-11
Status: accepted
Superseded-by: ADR-0095 — retires only the per-session file NAME; the flat key=value format and the location outside every project still stand
Reconciled: superseded — ADR-0095 keys the same flat files by repository, so the Hooks section's one-file-per-session reading is retired and the body deliberately reads otherwise.
Source: docs/blueprint.md amendment of 2026-07-11 (harness audit, 5-judge review), correction (a), deciding commit 8b8456e

## Decision

The Hooks section's `session.json` claim is stale: state lives in per-session flat files `~/.local/state/oso-code/<sanitized-session>.state` — key=value lines, one file per session — not a single JSON blob.

## Context

One of four frozen-section corrections a five-judge audit produced.
