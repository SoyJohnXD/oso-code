---
name: debt-sweep
description: Whole-change debt review after functionality is confirmed. Finds dead code, duplication, stray comments, and rubric violations across everything the change touched, then applies readability-only fixes — never behavior changes. Use when a plan-mode change is complete, or when the user asks to sweep a branch or recent work for debt.
argument-hint: [base ref, e.g. main]
context: fork
agent: general-purpose
---

# Debt sweep

Final quality phase over a whole change. Functionality is already confirmed — this pass makes the code clean, semantic, and debt-free. It never fixes functionality.

## Scope

Determine the changed files:

- If a base ref was given: `git diff --name-only <base>...HEAD` plus uncommitted changes.
- Otherwise: diff against the repository's default branch, plus uncommitted changes.

Only these files are in scope. Never touch anything else.

## 1. Verify

1. Read the full rubric at `${CLAUDE_SKILL_DIR}/../_shared/rubric.md` — all three sections apply here: file level per changed file, system level and debt markers across the whole change.
2. If the project is TypeScript/JavaScript, load the fallow tools via ToolSearch (`find_dupes`, `get_cleanup_candidates`, `audit`) and run them on the changed files. If fallow is unavailable or the stack does not apply, state that the sweep is rubric-only and continue.
3. Run the project's zero-warnings bar: lint, types, tests, build.

Collect findings as `file:line — violation`.

## 2. Apply

Fix every finding with the smallest edit that resolves it:

- Readability, semantics, dead code, duplication, and pattern alignment only.
- Never change behavior, add features, or refactor beyond a finding.
- If a finding reveals a real functional bug, report it in the final report — do not fix it here.

## 3. Re-verify

Re-run the rubric check and the project's zero-warnings bar on every file the sweep edited.

## Report

End with exactly one of:

- `Debt Sweep: passed` — plus what was cleaned, grouped by rubric section.
- `Debt Sweep: blocked` — plus the findings that could not be resolved and why.

Always list separately any functional bugs found (reported, not fixed). Save nothing to engram — the orchestrator owns persistence.
