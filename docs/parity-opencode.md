# OpenCode parity

Certification record for the OpenCode host, filled in by three suites under `core/test/certify/` — `opencode-contract-bar.test.ts`, `opencode-behavior-bar.test.ts` and `opencode-wave-runner-smoke.test.ts` — run under `OSO_CERTIFY=1` against the pinned binary. It records what those suites measured, what they left unmeasured, and how their rows diverge from the bash bars and smoke they port — never a description of intended behavior. Release-level host divergence between Claude Code and OpenCode remains ADR-0097's own obligation, extended by ADR-0151; this file no longer restates it.

## The pin

OpenCode 1.18.22 — `SUPPORTED_OPENCODE_VERSION` in `core/src/install/pins.ts`, the version every suite's own binary probe resolves the pinned binary against.

## What the suites measured

| Suite | Rows | Divergence from the bash it ports |
|---|---|---|
| `opencode-contract-bar.test.ts` | 58 | corrects a stale figure this document once carried: it recorded the contract battery at 67 passed, a number this port's own `CONTRACT_BAR_ROWS_PORTED` constant and its actually-registered row count both measure at 58 against the pinned binary — a correction from measurement, not a retitle |
| `opencode-behavior-bar.test.ts` | 11 | row-for-row port of `tests/opencode-behavior-bar.sh`, no row-count divergence |
| `opencode-wave-runner-smoke.test.ts` | 10 | `waveSmokeOutcome` in `core/test/certify/support/wave-isolation.ts` gives a host-auto-rejected worktree permission its own `host-refused-the-worktree` outcome, read out of the child's own stream the way `bootstrap/verify-opencode.sh` already read it. A session that ran and whose model produced nothing else has no such not-run lane: it resolves to `incomplete`, and the wave-runner isolation row's own assertion turns that into a FAILURE rather than a not-run line, exactly as the bash's `run_wave_smoke` treated it. The port carries that classification forward unchanged rather than adding the lane the refusal case gets — on a host whose free-tier model is rate-limited into producing nothing, that is the difference between a nightly red an operator can act on and one they cannot, recorded here as a standing divergence rather than fixed by this slice |

## Standing security residual carried from the release ledger

Two lexer bypasses at the production-deploy gate are ported record for record rather than closed, per `docs/rewrite/ts-core-roadmap.md`'s C2-D17: a command-string-carrying wrapper (`script -qc '…'`, `ssh host '…'`, `tmux new-session -d '…'`) whose payload lands as one quoted token no basename comparison matches, and an `xargs` replace-string splitting the line at `{`, so `echo --prod | xargs -I{} vercel {}` passes allowed and uncounted where `echo --prod | xargs vercel` is denied. Both holes are pinned as fixtures under `core/test/fixtures/gates/` and asserted in `core/test/gates/parity.test.ts` and `core/test/port/lexer.test.ts` rather than fixed; closing either is a security change and stays the operator's, as C2-D17 already recorded.

## What was and was not driven

The contract bar, the behavior bar and the wave-runner smoke have each been driven against a real, pinned OpenCode binary — the wave-runner smoke for the first time in a CI run, never having been wired into the nightly build before this record. The fourth certify suite under `core/test/certify/`, the Codex authenticated smoke, drives a different host; `docs/parity-codex.md` is where its own never-driven-here fact is recorded.
