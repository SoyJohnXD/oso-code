# 0106 — Codex host-contract claims are checked against the installed binary

Date: 2026-08-05
Status: accepted
Implemented-in: bootstrap/verify-codex.sh, tests/hooks-test.sh, docs/blueprint.md
Reconciled: applied — `verify-codex.sh` gains `host_contract_status`, a check that greps the resolved `codex` binary for two literal strings and compares its reported version to `SUPPORTED_CODEX_VERSION`; `hooks-test.sh` gains one behavioral case that drives `host_contract_status` itself through a fake `codex` shim on PATH, asserting all four outcomes — conformant, nonconformant, unverified, skip — including under `bash:3.2`.
Source: literal strings in the installed `codex-cli 0.146.0` binary resolved from `command -v codex` — the same evidence ADR-0105 corrected against — and the fact that ADR-0105's two rejected assertions passed unnoticed because nothing in the repo read the binary itself.

## Decision

`bootstrap/verify-codex.sh` gains a check that asserts exactly two claims about the Codex binary `command -v codex` resolves (followed through `readlink -f` where available):

1. It rejects `fork_context` and accepts `fork_turns` — proven by grepping the resolved binary for the exact literals `fork_context is not supported in MultiAgentV2; use fork_turns instead` and `` `fork_turns must be `none`, `all`, or a positive integer string` ``.
2. Its reported version matches `SUPPORTED_CODEX_VERSION`, the constant `install-codex.sh` already declares and this file already consumes — no second constant is introduced.

The check reports one of three outcomes:

- **conformant** — the version matches and both literals are present; an ordinary passing `check` line.
- **nonconformant** — the version matches but a literal is missing. This FAILS the report, counted in `failed:`, because the binary's contract text changed under a version the repo still pins. It does not block `install-codex.sh`: that script's own version gate is a separate, earlier mechanism, and an operator already running ahead of `SUPPORTED_CODEX_VERSION` must still be able to install — this check only reports that the claims verified against `0.146.0` are unconfirmed for what actually ran, never that installation itself must stop.
- **unverified** — the installed version differs from `SUPPORTED_CODEX_VERSION`, the exact version the two literals were read from on 2026-08-05. The check does not grep in this case: a literal moving between releases is expected, not a regression, so failing it would misreport an unconfirmed claim as a broken one. The message names both the window version and the installed one.

When `command -v codex` fails, the check reports skipped — `skip: Codex host contract — codex is not on PATH, so the host contract could not be asserted` — following this file's existing skip idiom (`impeccable_status`'s `opted-out` case), and is not counted as a pass.

## Context

ADR-0105 found that six sites instructed a spelling the installed host had already rejected, and two suite assertions pinned that rejected spelling — 1058 green tests protected a broken contract because every check in the repo asserted the harness against its own prose, never against the binary it targets. This decision is the mechanism that would have caught it.

The doubt pass raised an objection worth recording here: a skip lane that is CI's default path means the mechanism runs least exactly where drift lands latest, because CI never has Codex installed. That is why this layer is not primarily a `tests/hooks-test.sh` case — a suite-only check would skip on every CI run and execute only on a machine that happens to have Codex installed, reproducing the same blind spot ADR-0105 exposed. It lives in `bootstrap/verify-codex.sh` instead: the script the operator runs locally against their real binary, and the one the release process already requires. That placement is about where drift is CAUGHT, not about whether the check is testable: the `tests/hooks-test.sh` case drives `host_contract_status` itself through a fake `codex` on PATH, whose bytes carry (or omit) the two literals and whose `--version` reports a controllable string, exercising all four outcomes — conformant, nonconformant, unverified, skip — with no real Codex install, including under the `bash:3.2` container. That shim proves the check's own logic sound; it says nothing about any particular operator's actual binary, which is why `verify-codex.sh` run locally, not the suite, remains the mechanism that catches real drift.

## Consequences

- A future rejected or renamed literal in the Codex binary fails `verify-codex.sh` immediately, instead of surviving behind assertions that only check the harness's own prose.
- Failure here is diagnostic, not an install or release gate: an operator ahead of the declared version keeps installing.
- The version window keeps the two claims honest about what they were actually confirmed against, instead of asserting confidence the repo does not have for an untested release.
- CI, which has no Codex, still gets one always-on behavioral guarantee — via a fake `codex` shim — that `host_contract_status` itself has not silently regressed, not merely that its source text still contains certain substrings.
