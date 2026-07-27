# 0057 — Orphan state files are pruned at 7 days

Date: 2026-07-25
Status: accepted
Reconciled: elsewhere — landed in the SessionEnd hook; the frozen body names the files' lifetime but not the prune.
Source: docs/blueprint.md amendment of 2026-07-25 (gates-hardening), decision (D16), deciding commit 7d52356

## Decision

At SessionEnd, orphan `*.state` files are pruned at 7 days under own-file and lock guards.

## Context

Tagged to its own clause inside the audit-trail decision (ADR-0055), which is why it is its own record here. The guards are what keep one session from deleting another's live state.
