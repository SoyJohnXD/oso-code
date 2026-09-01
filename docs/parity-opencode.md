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

## Section inventory divergences

`tests/plugin-lint.sh`'s section-inventory rule compares this host's platform overlays under `plugin/skills/_shared/platform/opencode/` against the Claude Code and Codex counterparts of the same file name, and goes red when one of those sections has no answer here and no row below. What it compares is the CONCERN each heading names — the text up to its first em dash — rather than the heading's bytes: what follows the dash is the host's own qualifier and is free to differ, which is why `How far the chain runs unattended — all of it` and `— everything except each child's own stop` are one concern and not a loss. Byte parity is not the bar; an unrecorded absence is.

Each row names the overlay, the counterpart section this host does not carry under that concern, and where the concern is answered instead. `no counterpart file` in the second column declares the whole overlay absent. A row for a section this host DOES carry is itself a violation, so nothing can be pre-declared out of the comparison, and so is a row naming a section neither reference host carries.

| Overlay | Counterpart section | Why this host does not carry it |
|---|---|---|
| `delegation-wait.md` | no counterpart file | The overlay exists because a Claude Code launch returns an agent id at once and its report re-enters the conversation as a later completion notification, so that host needs a file for how a launch is waited on and for the `auto_wait` marker that holds its `Stop` net back. This host's `task` call is synchronous and returns the child's own final message in-band, so there is no later turn to bridge and no notification to wait for. The rule that remains — read the report before acting on it, block rather than fall through — is stated in `plan.md` and `debug.md` under `Making a launch wait`, the spelling Codex uses for the same concern. |
| `subagents.md` | no counterpart file | A Codex-only role map: that host selects a custom role by name at spawn (`codex.multi_agent.spawn` with `fork_turns="none"`) and needs a receipt protocol over `SubagentStop` to prove the message it read belongs to the launch it made. Here the roles ARE native agent files under `opencode/agents/`, named in the `task` call, and the verdict comes back in-band with no receipt to consume (D5). What the file would carry is already carried: the role list by the agent directory itself, the payload rules by each agent contract, and the handshake by the synchronous return. |
| `debug.md` | Delegation-wait binding | The binding is a pointer to `delegation-wait.md`, which this host does not carry for the reason above. The concern is answered in place, in this file's own `Making a launch wait` section. |
| `plan.md` | Delegation-wait binding | Same pointer, same substitution: this file carries `Making a launch wait` itself. |
| `quick.md` | Delegation-wait binding | Same pointer. Quick makes one launch here — the close's applier — and it returns in the turn that made it, so this flow needs no wait section of its own: the rule it would carry is stated in place, in this file's own `Naming and invoking the harness's own skills` section, exactly where the Codex counterpart records the same substitution for the same flow. |
| `front-surface.md` | Delegation-wait binding | Same pointer. The one launch this file routes — the design-findings applier — carries the answer in its own routing bullet: the `task` call blocks until the child returns, so the findings are consumed on the way back rather than awaited later. |
| `reporting.md` | The native card is not the report | The host's own spelling of one concern, not a lost one: each host names this section after the native surface it has, and there is no shared stem to normalize. Claude Code's native subagent card is what its section warns the milestone is not; this host's `Native agent files, no card` answers the same question — what the UI shows, and does not show, when the milestone contract fires. |
| `reporting.md` | No card exists here | The Codex spelling of that same concern, carried here as `Native agent files, no card`: this host draws no card either, but a launch runs one of its own native agent files rather than a custom role, and the section says so. |

## Standing security residual carried from the release ledger

Two lexer bypasses at the production-deploy gate are ported record for record rather than closed, per `docs/rewrite/ts-core-roadmap.md`'s C2-D17: a command-string-carrying wrapper (`script -qc '…'`, `ssh host '…'`, `tmux new-session -d '…'`) whose payload lands as one quoted token no basename comparison matches, and an `xargs` replace-string splitting the line at `{`, so `echo --prod | xargs -I{} vercel {}` passes allowed and uncounted where `echo --prod | xargs vercel` is denied. Both holes are pinned as fixtures under `core/test/fixtures/gates/` and asserted in `core/test/gates/parity.test.ts` and `core/test/port/lexer.test.ts` rather than fixed; closing either is a security change and stays the operator's, as C2-D17 already recorded.

## What was and was not driven

The contract bar, the behavior bar and the wave-runner smoke have each been driven against a real, pinned OpenCode binary — the wave-runner smoke for the first time in a CI run, never having been wired into the nightly build before this record. The fourth certify suite under `core/test/certify/`, the Codex authenticated smoke, drives a different host; `docs/parity-codex.md` is where its own never-driven-here fact is recorded.
