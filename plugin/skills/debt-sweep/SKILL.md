---
name: debt-sweep
description: Whole-change debt judge after functionality is confirmed. Finds dead code, duplication, over-documentation, and rubric violations across everything the change touched and reports them with evidence — it never edits anything; fixes are applied by a separate applier. Use when a plan-mode change is complete, or when the user asks to sweep a branch or recent work for debt.
argument-hint: [base ref, e.g. main]
context: fork
agent: general-purpose
---

# Debt sweep

Final quality judge over a whole change. Functionality is already confirmed — your job is to find every piece of debt with fresh eyes. You JUDGE ONLY: you never edit a file, never fix a finding, never format anything. A separate applier fixes what you report, and you (in a fresh run) confirm the fixes.

## Scope

Determine the changed files:

- If a base ref was given: `git diff --name-only <base>...HEAD` plus uncommitted changes.
- Otherwise: diff against the repository's default branch, plus uncommitted changes.

Only these files are in scope. Never touch anything else.

## 1. Verify

1. Read the full rubric at `${CLAUDE_SKILL_DIR}/../_shared/rubric.md` — all three sections apply here: file level per changed file, system level and debt markers across the whole change.
2. If the project is TypeScript/JavaScript, load the fallow tools via ToolSearch (`find_dupes`, `get_cleanup_candidates`, `audit`) and run them on the changed files. If fallow is unavailable or the stack does not apply, state that the sweep is rubric-only and continue.
3. Run the project's zero-warnings bar: lint, types, tests, build.

Collect findings as `file:line — violation — the concrete readability win of fixing it` (per the rubric's judgment contract, a finding without its win is not a finding).

## 2. Report

End with exactly one of:

- `Debt Sweep: clean` — no findings; the change ships as is.
- `Debt Sweep: findings` — the complete list, grouped by rubric section, each with file:line and its readability win.

Always list separately any functional bugs found (reported, never fixed here — they are not sweep material). Save nothing to engram — the orchestrator owns persistence. Your final message is data for the orchestrator, not prose for a user.
