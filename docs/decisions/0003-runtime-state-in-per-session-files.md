# 0003 — Runtime state lives in per-session flat files

Date: 2026-07-11
Status: accepted
Reconciled: applied — the Hooks section reads the per-session flat files this corrected to.
Source: docs/blueprint.md amendment of 2026-07-11 (harness audit, 5-judge review), correction (a), deciding commit 8b8456e

## Decision

The Hooks section's `session.json` claim is stale: state lives in per-session flat files `~/.local/state/oso-code/<sanitized-session>.state` — key=value lines, one file per session — not a single JSON blob.

## Context

One of four frozen-section corrections a five-judge audit produced.
