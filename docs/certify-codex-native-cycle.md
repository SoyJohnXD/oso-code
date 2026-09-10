# Codex native cycle certification

A recorded demonstration, not a check. One bounded real Codex run drove `arm → apply → verify → commit` against this tree's runtime, and this file records what the gates denied and what they let through. It is evidence about the run named below and about nothing else; re-running it produces a new record rather than re-proving this one.

## Conditions

- **Binary**: `codex-cli 0.153.2`, the `SUPPORTED_CODEX_VERSION` pin in `core/src/install/pins.ts`.
- **Home**: a disposable tree created for this run. `HOME`, `USERPROFILE`, `CODEX_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME` and `GIT_CONFIG_GLOBAL` all resolved inside it, so no path the run could name reached the operator's own `~/.codex`, `~/.local/state/oso-code` or this repository. Only `auth.json` was copied in, read from the operator's Codex home and never written back.
- **Project**: a throwaway `git init` repository inside the same disposable tree, with no commit before the run.
- **Runtime**: installed from this working tree with `node bootstrap/oso.js install --host codex --yes --no-impeccable --no-git-hook`, so the run measured the change rather than the released plugin.
- **Bound**: ten minutes of model time, spent as one 46-second session plus a 35-second first attempt that never reached the model.

## What the install wired

Eight wirings succeeded and one failed: `fallow-mcp` is not installed on this host, which the installer reports and the debt sweep falls back from. The install printed `Codex permissions are seeded once outside the managed region, and no later install rewrites that choice`, and the resulting `config.toml` carries `default_permissions = "oso"` with the harness state root and its worktree root as workspace roots — the seeded-once permission profile, exercised rather than routed around.

Two flags are declined rather than defaults:

- `--no-impeccable` keeps the install off GitHub, which the ten-minute bound cannot absorb.
- `--no-git-hook` is required here because the installer wires `core.hooksPath` in the SOURCE checkout, which is the operator's own repository. Without the flag the install correctly refuses and rolls back, reporting `core.hooksPath=… already owns this checkout's hooks`. The commit rail measured below is therefore the PreToolUse commit gate, never the git `pre-commit` hook.

## The first attempt, and what it measured

`codex exec --ephemeral` could not arm anything. Every `${OSO_STATE_BIN:-oso-state} … set …` call was denied by the unknown-tool gate with `shell-effects-unestablished`, because an ephemeral session writes no rollout file, the hook payload therefore carries no `transcript_path`, and `unattestedCodexRoot` reads that as `missing native hook identity`. Three denials, no arming, no cycle. The finding stands on its own: **an ephemeral Codex session cannot drive the harness**, because the harness's own state binary is refused for want of a native root attestation the ephemeral mode does not produce.

The same attempt also failed to start once before that, on this host's bubblewrap sandbox: the `oso` profile names `…/oso-code/worktrees` as a workspace root, that directory did not exist after install, and the sandbox helper created the synthetic mount target as a read-only regular FILE and then panicked trying to `mkdir` inside it. Creating the worktree root as a real directory before the session cleared it. This reproduces the read-only synthetic-mount limitation already recorded in `docs/parity-codex.md`, now with its trigger named: **a declared workspace root that does not yet exist on disk.**

That trigger is the run's one finding about the harness rather than about Codex, and it is closed rather than recorded: the install now creates every workspace root the profile it seeds declares, so the hand-made directory that unblocked this session is what a first session finds already there. `core/test/install/codex.test.ts` holds it against a fixture home that carries no prior oso-code state, which is the only kind of home the defect was ever visible on.

## The measured cycle

Run without `--ephemeral`, otherwise identical. Each row is one step of the prompt; the verdict column is the gate's, not the agent's.

| Step | Command or edit | Gates that judged it | Verdict, and which of them returned it |
|---|---|---|---|
| arm the mode | `${OSO_STATE_BIN:-oso-state} --session 1 set mode=plan` | commit, unknown, proddeploy | allowed by all three in silence — no armed state to read yet |
| apply, unarmed | `apply_patch` adding `cert.txt` | edits, unknown | **DENIED by `edits`** — `plan mode is active but no slice is active` |
| arm the slice | `${OSO_STATE_BIN:-oso-state} --session 1 set active_slice=1` | commit, unknown, proddeploy | allowed; `commit` counted it as residue, the other two were silent |
| apply, armed | `apply_patch` adding `cert.txt` | edits, unknown | allowed by both in silence |
| verify | `grep -c . cert.txt` → `1` | commit, unknown, proddeploy | allowed by all three in silence |
| stage | `git add cert.txt` | commit, unknown, proddeploy | allowed by all three in silence |
| commit, not green | `git commit -m "feat: certify the codex cycle"` | commit, unknown, proddeploy | **DENIED by `commit`** — `the session verify is not green` |
| green | `${OSO_STATE_BIN:-oso-state} --session 1 set verify_green=true` | commit, unknown, proddeploy | allowed; `commit` counted it as residue, the other two were silent |
| commit, green | `git commit -m "feat: certify the codex cycle"` | commit, unknown, proddeploy | allowed by all three — root commit `0029ac2`, one file changed |

The run stopped for no permission dialog and no operator decision. Both denials were absorbed and the run continued past them; the two denial messages reached the agent verbatim through Codex's own `PreToolUse hook` channel.

`proddeploy` returned a plain allowance on all nine steps and emitted nothing at all — the two residue counts are the commit gate's, both of them. Its boundary reads a run marker before it reads the line, and that marker is `auto=running` for this session; the prompt never armed the AUTO disposition, so every step left the gate at its unmarked allowance and no step reached the residue count at all. `commit` reaches it instead, on the state being present, not green, and the line reading as residue. `unknown` allowed in silence throughout, because a session that is not `--ephemeral` writes the rollout file whose absence is the whole subject of the first attempt above.

### How each attribution here was established

- **The verdict column is the run's own record.** The two denials and the two residue counts are the `events.jsonl` lines quoted below; the five rows no gate spoke on are read off the Codex stream and the resulting commit, because a clean allowance writes no event.
- **The gate columns are not readable off that record at all**, and were not read off it: a gate that allows in silence leaves nothing behind, so the log cannot say which gates ran or which one spoke. They were established by REPLAY — each of the nine steps fired at every gate `codex/hooks/hooks.json` routes its tool to, in manifest order (`Bash` → commit, unknown, proddeploy; `apply_patch` → edits, unknown), against this tree's `plugin/dist/gate.js` under a Codex envelope, on a disposable home and a throwaway repository. What makes it a replay of THIS run rather than a separate measurement is its output: the same seven events, in the same order, with the same command strings — save the `edit-denied` line, whose `command` the replay fills with the patched file's path because its synthetic payload named one where the run's did not.
- **The `proddeploy` reading was established against its own control.** The same replay re-fired the `set active_slice=1` line with `auto=running` armed for the session, and `proddeploy` then emitted `residue-allowed` beside `commit`'s — so the silence above is the missing run marker rather than a gate that never ran.
- **The first attempt's denial was established the same way**: the identical line with no `transcript_path` in the payload is denied by `unknown` with `shell-effects-unestablished`. That gate stands in every row of this table because the Codex manifest routes `.*` to it; what separates the attempt from the cycle is the rollout file, never the routing.
- Where a replay and the record could disagree, the record wins. They did not disagree.

## The gate record

Every line the run appended to the disposable `events.jsonl`, timestamps as recorded:

```
{"ts":"2026-09-10T13:22:22Z","event":"set:mode=plan","command":"","session":"1"}
{"ts":"2026-09-10T13:22:26Z","event":"edit-denied","command":"","session":"1","gate":"block-edits-without-slice.sh","hook_event":"PreToolUse"}
{"ts":"2026-09-10T13:22:29Z","event":"residue-allowed","command":"${OSO_STATE_BIN:-oso-state} --session 1 set active_slice=1","session":"1"}
{"ts":"2026-09-10T13:22:29Z","event":"set:active_slice=1","command":"","session":"1"}
{"ts":"2026-09-10T13:22:45Z","event":"commit-denied","command":"git commit -m \"feat: certify the codex cycle\"","session":"1","gate":"block-commit-until-green.sh","hook_event":"PreToolUse"}
{"ts":"2026-09-10T13:22:48Z","event":"residue-allowed","command":"${OSO_STATE_BIN:-oso-state} --session 1 set verify_green=true","session":"1"}
{"ts":"2026-09-10T13:22:48Z","event":"set:verify_green=true","command":"","session":"1"}
```

The allowed `apply_patch`, the allowed `grep`, the allowed `git add` and the allowed final `git commit` appear nowhere, because a clean allowance writes no event. **What the record proves is exactly what it names: two denials, two residue counts, three state writes.** The four silent allowances are read off the Codex stream and the resulting commit, not off this log.

Two fields in the raw lines are inherited noise rather than measurement: `client` reads `claude` because `CLAUDE_CODE_EXECPATH` was inherited into the run's environment, and `schema` is 2 throughout.

## What this run did not measure

- **The teardown sweeps.** `plan_approval_session` is armed by the plan-approval flow, not by a manual `set`, so `codexOwnsState` never proved ownership and the SessionEnd teardown correctly did nothing. Had it proved ownership it would have run the proven-owner set — the session's worktrees, its journal-keyed wait mark, its state file and lock, then the events-log rotation and the abandoned-state prune — and still not the two sweeps the native SessionEnd runs beside them, each held out on its own key. `clearRoadmapInFlightOf` selects on `session=`, and on Codex that key holds the agent index `1` rather than anything this session can be told apart by, so it would reach every repository whose state names the same index; `stateArmedBy` selects on the same key and is why the Codex path names its state file from the cwd instead. `clearOrphanedPendingOf` selects on `plan_approval_session`, the strong UUID, so the weak key is no argument against it — it is held out because it reads that key alone and takes no lock, and so would delete a state file whose `session=` half of ownership `codexOwnsState` also reads and this envelope never proved, and would delete it out from under a live holder. The Codex teardown is measured by `core/test/gates/teardown-codex-ownership.test.ts` and `core/test/gates/teardown-worktrees.test.ts` instead.
- **The installed interactive TUI.** This lane drives `codex exec` only, exactly as the Stop-continuation lane does.
- **The git `pre-commit` hook**, declined by `--no-git-hook` for the reason above.
- **`fallow-mcp`**, absent on this host.
- **A run under the AUTO disposition.** The prompt named the nine steps; the harness's own flow prose was installed but not driven.
