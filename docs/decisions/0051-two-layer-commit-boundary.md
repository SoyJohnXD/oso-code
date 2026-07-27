# 0051 — The commit boundary goes two-layer

Date: 2026-07-25
Status: accepted
Reconciled: applied — the Hooks section's first bullet reads the two layers.
Source: docs/blueprint.md amendment of 2026-07-25 (gates-hardening), decision (D13), deciding commit 7d52356

## Decision

A git `core.hooksPath` pre-commit hook (`plugin/git-hooks/pre-commit`) reading the same state file is the PRIMARY layer: it sits at the real commit boundary, so it sees aliases (`ci = commit`), wrappers (`flock`, `ssh`, `docker exec`), an absolute `/usr/bin/git` and non-Bash paths, with zero string parsing and zero false positives. The PreToolUse matcher becomes the SECOND layer for what a git hook cannot see: `--no-verify`, `commit-tree`, `update-ref`. Installer policy: a foreign `core.hooksPath`, or any non-`.sample` hook in the repo's hooks directory, means the layer is NOT installed there — never overwritten, never chained, named in the wiring summary — and `--no-git-hook` opts out.

## Context

The matcher alone had carried ~24 bypasses beside 9 false positives; a hook at the boundary needs no string parsing at all.
