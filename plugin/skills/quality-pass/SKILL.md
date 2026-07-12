---
name: quality-pass
description: Readability-only cleanup of touched code after functionality is confirmed. Verifies against the clean-code checklist, fixes what fails, and re-verifies — never changes behavior. Use when a change is functionally done, when the user asks for cleanup or a quality pass, or as the closing step of quick and plan modes.
---

# Quality pass

Align finished, working code with the team's quality bar. Scope: code touched in this session only — never untouched files.

## Contract

- Fix readability, semantics, and pattern violations. Never change behavior, add features, or "improve" logic.
- If a real functional bug surfaces, report it — do not fix it inside the quality pass.

## 1. Verify

Read the shared rubric at `${CLAUDE_SKILL_DIR}/../_shared/rubric.md` and check every touched file against its **Hard blockers**, **File level**, **System level**, and **Debt markers** sections. System level applies whenever the session touched more than one file or the change interacts with existing helpers or patterns. The **Judgment contract** governs how all of them are applied.

Then run the project's own bar: the checks recorded in the ledger when in plan mode, or discovered from the project otherwise — lint, types, affected tests, build, or whatever the project defines. Zero warnings.

## 2. Apply

Fix every finding from the verify step with the smallest edit that resolves it — no refactors beyond the finding.

## 3. Re-verify

Re-run the checklist and the project checks on the files you edited.

## Report

End with exactly one of:

- `Quality Pass: passed` — plus a one-line list of what was cleaned.
- `Quality Pass: blocked` — plus the findings you could not resolve and why.
