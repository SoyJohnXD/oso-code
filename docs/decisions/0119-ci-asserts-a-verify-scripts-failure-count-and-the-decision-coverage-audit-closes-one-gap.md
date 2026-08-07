# 0119 — CI asserts a verify script's failure count, and the decision-coverage audit closes one real gap

Date: 2026-08-06
Status: accepted
Reconciled: applied — both verify steps in `.github/workflows/ci.yml` now assert a pinned `failed:` count beside the pre-existing `grep -q '^passed:'`; `tests/hooks-test.sh` gained two assertions closing the one coverage gap the audit below found; nothing else in this change's decision set needed a new check.
Source: the pre-freeze doubt pass's finding that this change's bar "cannot fail on most of what it decides," resequenced to run after B7, B8-B9 and B10 landed their own lint rules — this decision is the audit of what remained once those three slices closed their share

## Decision

### Part 1 — a bar that can fail

`grep -q '^passed:' "$report"` alone is satisfied by a `passed: 2, failed: 8` line exactly as it is by `passed: 10, failed: 0` — the step goes green the moment the script reaches its own last line, whatever it printed above it. `|| true` is correct and stays: both scripts genuinely exit nonzero against a fixture HOME for reasons CI cannot avoid, so the exit code was never the verdict. What was missing is an assertion on the number the report actually names.

**Measured, the way CI runs each step** (`mktemp -d` HOME, the exact skip env var, and a `PATH` stripped of the tools this job never installs before these steps — `codex`, `claude` — which the runner genuinely lacks here too):

| Script | Fixture result | Reachable? |
|---|---|---|
| `bootstrap/verify.sh` (`OSO_VERIFY_SKIP_SLOW=1`) | `passed: 2, failed: 8` | Stable across repeated runs |
| `bootstrap/verify-codex.sh` (`OSO_VERIFY_SKIP_SMOKE=1`) | `passed: 0, failed: 14` | Stable across repeated runs |

`failed: 0` is unreachable for either script — confirmed, not assumed. The two scripts diverge in a way that matters for what "the honest fix" can be:

- **`verify.sh` has real headroom.** Two checks owe nothing to the missing install and pass on a bare fixture HOME every time: "legacy artifacts removed" (nothing was ever installed to leave artifacts) and "shipped executables carry no CR bytes" (a property of the checked-out tree, not of an install). A floor exists to assert.
- **`verify-codex.sh` has none.** This job never installs the `codex` CLI at any point before this step runs, and every one of its fourteen local checks needs that install to produce anything but a failure — there is no check left that owes nothing to it. `passed: 0` is not a fixture quirk; it is the entire assertable suite, every time, by construction of this job.

Given that split, the same assertion shape cannot serve both steps honestly. Both now assert a **pinned `failed:` count**, extracted from the report and compared with `=`:

```sh
failed="$(sed -n 's/^passed: [0-9]*, failed: \([0-9]*\)$/\1/p' "$report")"
[ "$failed" = "8" ]   # verify.sh
[ "$failed" = "14" ]  # verify-codex.sh
```

A pin, not a ceiling or a floor, for both — including `verify.sh`, which does have headroom for a floor (`passed -ge 2`). A ceiling only has teeth where the fixture is below 100% failure; on `verify-codex.sh` the failed count is already at its structural maximum, so a ceiling (`-le 14`) can never be violated and provides no signal at all — the identical defect this whole slice exists to remove, reintroduced through the back door. An exact pin is the only shape that has real signal on both scripts, so both use it: a check that starts passing, one that stops running, or a new one that joins all move the number and turn the step red, on either script, whichever direction the drift runs.

**Demonstrated, not asserted:** on a `cp -a` scratch copy, a CR byte appended to `plugin/bin/oso-state` moved `verify.sh`'s fixture from `passed: 2, failed: 8` to `passed: 1, failed: 9` — the old `grep -q` stayed green, the new `[ "$failed" = "8" ]` correctly rejected it. Silently dropping one `check` call from `verify-codex.sh`'s `run_local_checks` (simulating a check that stopped running without anyone noticing) moved its fixture from `failed: 14` to `failed: 13` — same result: the old assertion stayed green, the new one rejected it.

**Installing `codex` in this job so `verify-codex.sh` gets a real floor too** — the way `verify.sh` already has one — was considered and rejected here. It would give the step real signal on two more checks (`Codex CLI version`, the host-contract check), but it also adds a network dependency and CLI-provisioning cost to a step whose sibling step is deliberately free of both, on the same reasoning: this job runs both verify scripts before any CLI is installed, on purpose, so the fixture is the worst case an operator's install can start from. That tradeoff is named here rather than decided; the pin is the fix in scope for "fix the assertion, not the `|| true`," and it already turns this step red the moment its behavior changes, which is the property this slice exists to buy.

Whichever script's count moves, the fix is to update the pinned number to the new legitimate baseline and say why in the same commit — never to loosen the assertion back toward a floor or a ceiling to make a real regression disappear quietly.

### Part 2 — the decision-coverage audit

The doubt pass that opened this slice found the change's bar could not fail on most of what it decides, because most of it is markdown-contract prose no test can execute. Slices B4-B5, B7, B8-B9 and B10 each closed that gap for their own decision, taking `tests/plugin-lint.sh` from 13 rules to 20. This is the audit of what was left once those four slices landed: every decision this change made, walked against the current tree, naming the check that guards it or stating plainly that none exists.

| Decision | ADR | Kind | Check |
|---|---|---|---|
| Host-contract conformance | 0106 | executable (`bootstrap/verify-codex.sh`) | `tests/hooks-test.sh` "Codex host contract" section — four shim variants (conformant, nonconformant, unverified-version, no-codex-on-PATH), each asserted against its own exact output line |
| Allowlist content in the unknown-tool remedy | 0111 | executable (`plugin/hooks/block-unknown-tool.sh`) | `tests/hooks-test.sh` "B1 (D18)" section — the remedy is asserted to name a real allowed tool, read live off the same `$allowlist` the gate validated, never a second copy |
| The two identity keys (`session` / `plan_approval_session`) | 0107 | executable (`plugin/bin/oso-state`, hook scripts) | `tests/hooks-test.sh` — the catch-all's pending-check scoping, `plan_approval_session`'s survival across a model-issued write, and its own SessionEnd sweep, each with a dedicated section |
| The audit record's shape (`schema`, `gate`, `hook_event`, six distinct marker messages) | 0108 | executable (`plugin/hooks/lib.sh`) | `tests/hooks-test.sh` — schema version, the six distinct `stop_block` sentences and the tool/path/command detail were already asserted; **`gate` and `hook_event` were not** (see below — closed by this slice) |
| Judge sandboxes (`sandbox_mode`, the never-edit-source sentence) | 0109 | data (Codex role TOML) | `tests/hooks-test.sh` — `toml_scalar` assertions pin `workspace-write` / `read-only` per role by name, plus a dedicated assertion for the never-edit-source sentence on the two moved roles |
| The migration and the honest rollback | 0110 | executable (`bootstrap/install-codex.sh`) | `tests/hooks-test.sh` "Codex installer: migrates…" and "…a partial rollback tells the truth" sections — all three migration cases (backfill, clear, idempotent) and an injected partial-restore failure, each asserted |
| Executable remedies and the recovery-route declaration | 0111 | executable (hook scripts) + structural (`tools/render-hooks-json.sh`) | `tests/hooks-test.sh` "B1 (D18)" section for the remedy text; the same file's recovery-route fixture (`sed '/^# Recovery:/,+1d'` then `assert_renderer_rejects`) proves a gate script missing its header fails the table check |
| Feedback amends a pending plan in place | 0112 | executable (`plugin/bin/oso-state`, `approve-plan-token.sh`) | `tests/hooks-test.sh` — the amend-while-pending path, the content-parity refusal on a stale digest, and `plan_approval_session` survival, each asserted |
| The scoped stale warning | 0113 | executable (`plugin/hooks/warn-stale-state.sh`) | `tests/hooks-test.sh` "SessionStart: only THIS repository's own stale state…" — all four cases (foreign-silent, own-fires, dropped claim, remedy reaches what was named) |
| `blocked` routing | 0114 | markdown-contract | `tests/plugin-lint.sh`'s `check_call_sites_speak_their_emitters_verdict_vocabulary` — per-axis, line-scoped, route-verb-paired. **ADR-0114's own text already names a real limit this audit does not reopen**: the Codex-side caller-detection branch never fires for four of the five judges (debt-sweep, doubt-pass, triage, security-pass), because none of `plan.md`'s bound Codex sources carry the `` `oso-code:<emitter>` `` identity that branch keys on — a pre-existing gap ADR-0114 explicitly declined to close, not a silent one this audit is newly disclosing |
| Milestone reporting | 0115 | markdown-contract | `tests/plugin-lint.sh`'s `check_milestone_reporting_contract_is_complete` and `check_reporting_host_difference_is_single_sourced` |
| Impeccable's real contract (design-foundation slice) | 0116 | markdown-contract | `tests/plugin-lint.sh`'s `check_design_foundation_slice_reads_the_installed_contract` |
| The third amendment lane | 0117 | markdown-contract | `tests/plugin-lint.sh`'s `check_third_amendment_lane_names_its_conditions`, with an injected-failure fixture in `tests/hooks-test.sh` (B9) proving it rejects a lane that drops one condition |
| Three coordinates (CHANGE BASE / WAVE START / SLICE START) | 0118 | markdown-contract | `tests/plugin-lint.sh`'s `check_plan_delegation_payloads_name_a_specific_coordinate`, `check_integrator_report_names_next_wave_start`, `check_triage_names_wave_start_unambiguously` |

**The one gap the audit found and closed.** ADR-0108 states its whole point in one sentence: "a deny is now diagnosable from the log alone: which gate fired, on which hook event." Nothing before this slice ever grepped a logged line for `"gate":` or `"hook_event":` — the schema version, the command detail and the six distinct marker sentences were all asserted, but the two fields the decision was actually about were not, so a future edit that stopped `deny()` from passing them to `log_event` would have left the suite green. `tests/hooks-test.sh` now asserts both fields on a deny's own logged line, and — the other half of the same decision, that these two fields are scoped to deny-shaped calls so the log's highest-volume lines do not grow — asserts their absence from an `oso-state event` line. This is a `tests/hooks-test.sh` regression assertion, not a `tests/plugin-lint.sh` rule: the fact it guards is a runtime JSONL field an executable hook script writes, not prose a lint rule could read from a skill or agent file, so the linter's rule count is unmoved by this slice.

**The gap left deliberately open.** ADR-0114's Codex-side vocabulary-checking limit (above) is not this slice's to close. It is already named, in the decision's own text, as a scope boundary ("out of scope for a `blocked`-routing change") that would require rethinking how Codex names a forked judge as a caller-detectable identity at all — an architecture question, not a missing check this slice can add without re-deciding what ADR-0114 already decided. Naming it again here, beside every other decision this audit walked, is the honest record; closing it is not this slice's to take.

## Consequences

- Both CI verify steps go red the moment either script's fixture-HOME behavior changes, in either direction — proven on scratch copies for both, not merely asserted.
- The pinned counts are baselines, not intentions: a future slice that legitimately changes either script's check set updates the pinned number in the same commit, the same way this repo already updates the linter's rule count and `tests/hooks-test.sh`'s own fixtures when a rule lands.
- Every decision this change made through ADR-0118 now has a named guard or a named, reasoned absence — no decision in the table above reads "no check exists" without either a fix landing here or a citation to where the absence was already decided.
- `tests/plugin-lint.sh` stays at 20 rules: the one gap this audit closed was executable, not markdown-contract, so no new lint rule, rule-count fixture update, header-table edit or README row was needed.
