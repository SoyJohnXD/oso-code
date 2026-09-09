# Codex parity

Certification record for the Codex host, filled in by `core/test/certify/codex-authenticated-smoke.test.ts` under `OSO_CERTIFY=1` against the pinned binary. It records what that suite measured, what it left unmeasured, and how its rows diverge from the bash smoke it ports — never a description of intended behavior. Release-level host divergence between Claude Code and Codex remains ADR-0097's own obligation; this file no longer restates it.

## The pin

Codex 0.153.2 — `SUPPORTED_CODEX_VERSION` in `core/src/install/pins.ts`, the version the smoke's own pin-relation row resolves the installed binary against.

## Installer deployment

`oso install --host codex --yes` stages the published marketplace and plugin manifest under `~/.local/share/oso-code/codex-marketplace`, copies the trust-listed runtime and seven agent contracts into the Codex home, and registers the local marketplace and `oso-code@oso-code` through `codex plugin marketplace add` and `codex plugin add`. Re-running the install replaces the owned payload while preserving operator config, agents, plugins, skills and Engram memory; every owned target is included in the install backup used for rollback.

The install runs `engram setup codex` and verifies the resulting MCP server and instruction files. Impeccable is registered from `pbakaus/impeccable` at `skill-v4.0.2` and its published Codex skill, references and frontmatter are checked before the home mount is replaced. `--no-impeccable` records an explicit opt-out for verification.

The disposable host probes recorded for this slice drove the measured CLI (version 0.153.2) through marketplace add, plugin add/list and Engram setup successfully with empty stderr in a writable isolated state root. The same binary's `sandbox -P oso /bin/true` probe remains unavailable on this host because its bubblewrap synthetic-mount lock is read-only; no installer or verifier result treats that boundary as live host acceptance.

## What the suite measured

| Row | What it reports | Divergence from `run_authenticated_smoke` |
|---|---|---|
| 1 | the installed Codex binary's relation to the 0.153.2 pin | new — the bash smoke carried no pin-relation check of its own |
| 2 | Codex authentication is a precondition the smoke reproduces before any exec is attempted | matches the bash's `Codex authentication` check by name |
| 3–7 | the spawned `oso-integrator` agent's handoff consumed, the integrated file's content, the ancestor check, the branch-gone check, the worktree-gone check | the bash's single `authenticated integrator smoke` check folded these five facts into one pass/fail; the port decomposes it into five independent rows, so the two do not correspond one row to one check |
| 8 | the integrator smoke fixture's temporary tree is removed, on both the success and the failure path | matches the bash's `integrator smoke fixture cleanup` check by name |

Eight rows measure five more facts than the bash's three named checks, none of them a new capability the bash lacked — the decomposition states independently what the bash's one compound check already required together.

## What was and was not driven

Row 1's pin-relation probe has been driven against a real, pinned binary check. The integrator rows remain not-run in this suite because CI leaves the smoke's full-access opt-in, `OSO_CERTIFY_ALLOW_CODEX_FULL_ACCESS_SMOKE`, default-closed by design: that lane spawns a Codex agent with `--sandbox danger-full-access` under the operator's own credentials. Every such authenticated row therefore reports not-run in the nightly build, which is correct rather than a gap this record owes a fix for.

## Stop continuation lane

`core/test/certify/codex-stop-continuation.test.ts` adds one separately gated `codex exec` row for the measured Stop transport. It requires both `OSO_CERTIFY=1` and `OSO_CERTIFY_ALLOW_CODEX_STOP_PROBE=1`, copies only `auth.json` into a temporary Codex home, installs one temporary Stop hook, runs with `--sandbox read-only`, and removes the temporary tree in a `finally` block. The process is bounded to 180 seconds and the validator requires exactly two Stop observations; no Codex plugins, agents, or interactive TUI state are copied. The installed TUI remains an explicit not-run row.

The unit lane always runs without credentials and rejects a missing hook, a first response without its continuation, a missing second Stop, malformed JSONL, nonzero exit, or timeout. A prior isolated probe of CLI release 0.153.2 measured `PROBE_FIRST`, then `PROBE_CONTINUED_7f43`, with exactly two Stop observations (`stop_hook_active=false` then `true`) and no second user input. That probe measured `codex exec` only; it is not evidence about the installed TUI.
