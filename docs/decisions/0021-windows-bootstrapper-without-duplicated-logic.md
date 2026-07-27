# 0021 — The Windows bootstrapper duplicates no logic

Date: 2026-07-16
Status: accepted
Superseded-by: ADR-0074 — retires only the registry-PATH re-read's replace semantics; the delegation chain, the provisioning and the CI boundary still stand
Reconciled: elsewhere — landed in bootstrap/ and .github/workflows/ci.yml; the frozen body never carried the install path.
Source: docs/blueprint.md amendment of 2026-07-16 (windows-install-behavior), joint marker (D1/D10/D4), deciding commit 2905cde

## Decision

`install.bat` (double-click) calls `install.ps1` — PS 5.1-safe; winget-provisions Git.Git, jqlang.jq and OpenJS.NodeJS.LTS per-user; installs Claude Code via the official `irm https://claude.ai/install.ps1` in a child powershell when missing; re-reads the registry PATH for winget lag; honest exit codes — which delegates to the same `install.sh` under Git Bash. `-CiMode` is the documented CI boundary, and `ci.yml` gains a `test-windows` job.

## Context

Filed under one marker covering three numbers, and the entry never separates them: one sentence, one delegation chain, one artifact, with the CI boundary a rider on the same script.
