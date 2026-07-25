---
name: debt-sweep
description: Whole-change judge after functionality is confirmed, on two axes — code debt (dead code, duplication, over-documentation, rubric violations) and ledger conformance (the assembled change against the frozen decisions that shaped it). Reports both with evidence in separate sections — it never edits anything; fixes are applied by a separate applier. Use when a plan-mode change is complete, or when the user asks to sweep a branch or recent work for debt.
argument-hint: "[base ref, e.g. main] [+ frozen ledger: bare decisions + scope]"
context: fork
agent: general-purpose
background: false
model: opus
---

# Debt sweep

Final quality judge over a whole change. Functionality is already confirmed — you judge with fresh eyes on two independent axes: **code debt** (dead code, duplication, over-documentation, rubric violations) and **ledger conformance** (the assembled change against the frozen decisions that shaped it). The two are reported in separate sections so neither masks the other. You JUDGE ONLY: you never edit a file, never fix a finding, never format anything. A separate applier fixes what you report, and you (in a fresh run) confirm the fixes.

## Scope

Determine the changed files:

- If a base ref was given: `git diff --name-only <base>...HEAD` plus uncommitted changes.
- Otherwise: diff against the repository's default branch, plus uncommitted changes.

Only these files are in scope. Never touch anything else.

## 1. Verify

1. Read the full rubric at `${CLAUDE_SKILL_DIR}/../_shared/rubric.md` — all five sections apply here: the **Judgment contract** governs every finding, **Hard blockers** and **File level** per changed file, **System level** and **Debt markers** across the whole change.
2. If the project is TypeScript/JavaScript, load the fallow tools via ToolSearch (`find_dupes`, `get_cleanup_candidates`, `audit`) and run them on the changed files. If fallow is unavailable or the stack does not apply, state that the sweep is rubric-only and continue.
   A skip is only a skip with evidence behind it:

   | Trap | Reality |
   | --- | --- |
   | 'fallow probably doesn't apply here' | 'Unavailable' means you tried the call or checked the stack and can name what you saw — otherwise it's a dodge. |
   | 'rubric-only is faster and usually enough' | Faster is not the bar — fallow catches dupes and dead code the eye misses. |
   | 'the stack is TS but this change is trivial' | Trivial diffs still hide clones and dead exports — fallow runs on the changed files regardless. |
3. Run the project's zero-warnings bar: the checks recorded in the ledger, or discovered from the project otherwise — lint, types, tests, build, or whatever the project defines.

Collect findings as `file:line — [severity: blocker|structural|nit] — violation — the concrete readability win of fixing it` (per the rubric's judgment contract, a finding without its win is not a finding). Blocker for Hard-blocker-class debt, structural for file- and system-level shape, nit for cosmetic wins.

## 2. Ledger conformance

A second axis, judged and reported apart from debt. The `/plan` orchestrator passes the frozen ledger in this skill's invocation ARGUMENTS, alongside the base ref and in the shape the `argument-hint` declares — the BARE decisions + scope only, never the rationale or rejected alternatives: you check the assembled code against what was decided, and a judge who reads the author's reasoning anchors on it.

Judge the change against the ledger and flag every gap:

- **Unimplemented** — a decision with no trace in the diff.
- **Contradicts-decision** — an implementation that does the opposite of, or diverges from, a decision.
- **Scope-creep** — work traceable to no decision and no in-scope item.
- **Partial** — a decision implemented halfway.

When no ledger is provided (direct operator invocation on a branch, or any non-plan flow), report `no ledger provided — conformance axis skipped`, run the debt axis alone, and NEVER fabricate a ledger to judge against.

## 3. Report

Two labeled sections, never merged — a conformance gap must never hide inside the debt list, nor a debt finding inside conformance.

**Debt findings** — end with exactly one of:

- `Debt Sweep: clean` — no debt; the change ships as is.
- `Debt Sweep: findings` — the complete list ordered by severity (blocker first, then structural, then nit), each with file:line, its severity tier, and its readability win.

**Ledger conformance** — end with exactly one of:

- `Conformance: clean` — every decision is implemented and every change traces to a decision or in-scope item.
- `Conformance: findings` — each gap tagged (unimplemented | contradicts-decision | scope-creep | partial), with the decision or scope item it violates and the file evidence.
- `Conformance: skipped — no ledger provided` — direct-branch or non-plan invocation; the debt axis ran alone.

Always list separately any functional bugs found (reported, never fixed here — they are not sweep material). Save nothing to engram — the orchestrator owns persistence. Your final message is data for the orchestrator, not prose for a user.
