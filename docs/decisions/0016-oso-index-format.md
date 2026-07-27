# 0016 — The `oso/index` format is standardized once

Date: 2026-07-12
Status: accepted
Reconciled: elsewhere — landed in the skills; the frozen body names the recall row but not its shape.
Source: docs/blueprint.md amendment of 2026-07-12 (walkthrough-before-approval), decision (D8), deciding commit 4e565fa

## Decision

A rich title (`oso/index — {project}: {n} changes, active: {change}`), a `NEXT:` line, the status vocabulary `planning / executing / done / roadmap`, literal topic keys as detail with dash wiki-links banned, roadmap parents listing their child changes, and explicit non-code pendings.

## Context

The index exists to be searched first instead of guessing topic keys, which only works if every row is written the same way.
