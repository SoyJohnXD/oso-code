# 0065 — `tests/plugin-lint.sh` grows to six rules

Date: 2026-07-25
Status: accepted
Reconciled: elsewhere — landed in tests/plugin-lint.sh; the frozen body never carried the linter's rules.
Source: docs/blueprint.md amendment of 2026-07-25 (c-mechanisms), decision (g), deciding commit 7d52356

## Decision

`tests/plugin-lint.sh` grows from two rules to six, all decidable: a `context: fork` skill must declare an `end with exactly one of:` verdict block; every call site of a skill that declares one must carry at least one of its tokens verbatim, since a caller looping on a bare `clean` never terminates on `Conformance: skipped — no ledger provided` and opens its gate over an axis that never ran; `security-pass` must not acquire its diff from a remote-qualified ref; and no file under `plugin/`, `docs/` or the changelog may carry a placeholder where the detect gate's pin belongs.

## Context

**What the call-site rule actually enforces.** The text above records only the floor — at least one token. The implemented rule carries a second half: a call site that names an axis's other verdicts must also name that axis's skipped verdict, since `/plan` gates its green write on `Conformance: skipped — no ledger provided` not satisfying it while the floor alone stays clean when that token is deleted. Requiring the full token set was never implementable — `/debug` passes no ledger and names three of the sweep's five tokens legitimately — but requiring the token a gate depends on is.

**Contradiction, recorded and not resolved.** This decision records the file growing from two rules to six; ADR-0058 records it arriving as a new file covering six. `git cat-file -e 7d52356^:tests/plugin-lint.sh` fails with rc 128 and `git log --diff-filter=A -- tests/plugin-lint.sh` names only `7d52356`, so the file never existed before that commit and there was no two-rule state to grow from. Git's answer is recorded; neither decision is rewritten to match it.
