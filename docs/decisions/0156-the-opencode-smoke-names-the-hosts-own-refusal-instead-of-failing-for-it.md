# 0156 — The OpenCode wave smoke names the host's own refusal instead of failing for it

Date: 2026-08-23
Status: accepted
Reconciled: applied — `bootstrap/verify-opencode.sh` splits what the smoke found into a breach and an incompleteness, reads the host's own auto-reject line out of the captured child stream, and takes the `record_smoke_not_run` lane it already had; `tests/hooks-test.sh` proves both directions against seeded child logs, with no host and no model required
Source: this change (opencode-runtime-parity), slice 23; two independent measurements of `bootstrap/verify-opencode.sh` against OpenCode 1.18.20 that disagree, and are both recorded below

## Decision

**A headless child that never wrote inside its worktree because the HOST refused it permission to is a smoke that did not run, not an isolation check that failed. A child that wrote inside the other one's worktree is still red, and nothing about the refusal softens that.**

### The two measurements, and why both are in this file

Earlier in this change, three of three clean-install runs closed `passed: 17, failed: 1`, and the single failure was the smoke's isolation check reporting `wt1-proof wt2-proof`. The cause is verbatim in the captured child stream: `! permission requested: external_directory (…/wt2/*); auto-rejecting`, after which the child's write returns `The user rejected permission to use this specific tool call.` Neither child could create its proof file.

The four assertions the check is NAMED for — wt1 holding wt2's proof, wt2 holding wt1's, and the root holding either — never fired in any of those runs. Isolation was never violated. The verifier was reporting the host's own permission decision as a failure of the tree, and `bootstrap/verify-opencode.sh` is the command the README hands an OpenCode operator: exiting 1 on a correct install is how a person learns to ignore a red.

Three of three runs taken while writing this decision closed `passed: 18, failed: 0` and exit 0, with the smoke completing and isolation proven, on `opencode/hy3-free` — the first free entry the host catalog offered at that moment. So the refusal is real and it is NOT deterministic. The smoke picks its model out of the host's own catalog at runtime because the free roster rotates, and whether a child's write raises an `external_directory` question at all depends on what the model does: a write aimed at the current working directory is inside the session's own pin, while a write aimed at the absolute worktree path is a directory the host measures against `sandboxes`, which lists the ROOT of the project and not the worktree. Same host, same pin, same fixture, two different models, two different verdicts.

That is exactly why the lane is a DETECTION and not a skip. It never softens a run that completed, it never converts a failure it cannot attribute, and it fires only where the host said in its own words that it refused.
### The shape

The smoke already had a not-run lane and four reasons to take it — the skip switch, no binary, no node, no free model, no session. The fix is a fifth, and it is a detection rather than a guess: `run_wave_children` now records a BREACH (a proof file where it does not belong) separately from an INCOMPLETENESS (a child's own proof or verdict missing), and `wave_smoke_outcome` resolves the two into one word. A breach outranks everything, so a genuine violation is red whether or not the host also refused something. An incompleteness with the host's auto-reject line in either child's captured stream is `not run:`, named in the report, with the script still exiting 3. An incompleteness with no such line behind it stays red, which is the case where the children really did fail.

Declining this was the previous position and the argument for it was that a fix would need an undocumented host config key. It does not: the script already has `record_smoke_not_run`, and the host emits an unambiguous, greppable line. Nothing about the host's configuration is guessed at here — the detection reads what the host already printed.

## Consequences

- On an install where the host refuses, the verifier closes `passed: 17, failed: 0` and exits 3 with `wave-runner smoke not run: the host auto-rejected an external_directory permission…`; where it does not, the run is untouched and closes `passed: 18, failed: 0` at exit 0, which is what three runs of it measured here. The limitation is visible in the report when it applies and absent when it does not, and either way it stays out of the failure count, where it was never true.
- CI is unaffected: its step runs with `OSO_VERIFY_SKIP_SMOKE=1` and takes the first not-run lane, so the pinned `passed: 16, failed: 0` still measures exactly what it measured.
- Both directions are proven without a host: the suite sources the verifier in a subshell, seeds two child logs and asserts the outcome word — `host-refused-the-worktree` for the refusal, `breached` for a seeded cross-worktree write under the SAME refusal, `incomplete` for a failure with no refusal behind it.
- The detection is one line's text in one host version. If that spelling changes, the smoke goes back to reporting red for a permission decision, which is loud rather than silent — the direction a verifier should fail in.
- Because the trigger is model-dependent and the model is chosen at runtime, neither verdict is reproducible on demand. An operator who sees `17/1` on this check and no `not run:` line beside it is looking at a host that refused in a spelling this detection does not know, and that is a new measurement rather than a defect in the tree.
