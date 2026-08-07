# 0021 — The Windows bootstrapper duplicates no logic

Date: 2026-07-16
Status: accepted
Superseded-by: ADR-0074 — retires only the registry-PATH re-read's replace semantics. ADR-0127 and ADR-0129 retire only "best effort is the whole of install.ps1's job", replacing it with a fail-closed preflight and a consent-bound elevation policy; the delegation chain, the single installer implementation and the CI boundary still stand
Reconciled: elsewhere — landed in bootstrap/ and .github/workflows/ci.yml; the frozen body never carried the install path, and Bootstrap responsibilities item 1 carries only the preflight ownership ADR-0127 added.
Source: docs/blueprint.md amendment of 2026-07-16 (windows-install-behavior), joint marker (D1/D10/D4), deciding commit 2905cde

## Decision

`install.bat` (double-click) calls `install.ps1` — PS 5.1-safe; winget-provisions Git.Git, jqlang.jq and OpenJS.NodeJS.LTS per-user; installs Claude Code via the official `irm https://claude.ai/install.ps1` in a child powershell when missing; re-reads the registry PATH for winget lag; honest exit codes — which delegates to the same `install.sh` under Git Bash. `-CiMode` is the documented CI boundary, and `ci.yml` gains a `test-windows` job.

The thesis this file was filed for is unchanged: there is ONE installer implementation, it is `install.sh`, and Windows reaches it under Git Bash rather than through a PowerShell port that would have to be kept in step with it forever. What `install.ps1` is on the way there has changed, and this decision no longer describes it as a thin delegator. It is the preflight OWNER: it asserts every requirement — including a Node floor and the Git Bash it is about to delegate through — before any delegation, and stops there naming every gap at once (ADR-0127); and its provisioning is bound by an explicit per-user-first, consent-before-UAC policy rather than the best-effort retries this entry recorded (ADR-0129). `-CiMode` is still the CI boundary, and it now runs the delegation itself against a stub that records argv, so a forwarded flag that stops being forwarded is caught by CI rather than by an operator.

## Context

Filed under one marker covering three numbers, and the entry never separates them: one sentence, one delegation chain, one artifact, with the CI boundary a rider on the same script. The delegation half of that sentence held for three releases; the "best effort provisioning" half is what a real clean Windows machine measured against it, and what ADR-0127 and ADR-0129 replace.
