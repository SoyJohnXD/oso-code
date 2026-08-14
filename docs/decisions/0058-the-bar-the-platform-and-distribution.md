# 0058 — The bar, the platform, and distribution

Date: 2026-07-25
Status: accepted
Supersedes: ADR-0038 (its `model: opus` pin on `/debug`)
Superseded-by: ADR-0150 — retires only "the foreground requirement for applier and verifier is stated in both `plan` and `debug`", and by a schema read rather than a change of mind: the `Agent` tool has never carried a foreground flag, so what those two files stated was unfollowable and every delegation ended its turn. What that clause was FOR — the applier's report is read before the verifier runs — is the invariant that decision states instead, and how a host delivers the report is its platform file's. The three forked skills pinning `background: false` and the `model: opus` reasoning that removes the pin from `plan` and `debug` while the forks keep it both stand, along with every other clause this decision records
Reconciled: elsewhere — landed in the tests, the skills, `.gitattributes` and ci.yml; the frozen body never carried the bar.
Source: docs/blueprint.md amendment of 2026-07-25 (gates-hardening), joint marker (D9/D11/D10/D17), deciding commit 7d52356

## Decision

The hook suite grows from 36 to 313 cases, with rc and stderr assertions inside the helpers — a crashing hook used to abort the run silently — and payload builders whose envelope shape is copied from recorded `PreToolUse` entries. A new `tests/plugin-lint.sh` covers the six rules `claude plugin validate --strict` has no opinion on: every forked skill declares `background`; every forked skill declares an `end with exactly one of:` verdict block; every `oso-code:<name>` the plugin's prose references resolves to a real skill or agent file; every call site of a skill that declares such a block carries at least one of its verdict tokens verbatim; `security-pass` never acquires its diff from a remote-qualified ref; and the Impeccable detect gate never carries a placeholder where its pin belongs. The three forked skills pin `background: false`, the foreground requirement for applier and verifier is stated in both `plan` and `debug`, and `model: opus` is removed from `plan` and `debug` because the override lasts only the invoking turn, while the forks keep it, where one invocation is one agent run. `.gitattributes` pins line endings, and `ci.yml` gains a `bash:3.2` container step.

## Context

Filed under one marker covering four numbers, and the entry never separates them: one bar, raised across the suite, the linter, the model pins and the platform. The 2026-07-22 entry attributes the `/debug` pin removal to D11 inside this group; this entry attributes nothing, so no split here would be derived rather than invented.

**Contradiction, recorded and not resolved.** This decision records `tests/plugin-lint.sh` as a NEW file covering six rules; ADR-0065 records the same file growing from two rules to six. `git cat-file -e 7d52356^:tests/plugin-lint.sh` fails with rc 128 and `git log --diff-filter=A -- tests/plugin-lint.sh` names only `7d52356`, so the file never existed before that commit and there was no two-rule state to grow from. Git's answer is recorded; neither decision is rewritten to match it.
