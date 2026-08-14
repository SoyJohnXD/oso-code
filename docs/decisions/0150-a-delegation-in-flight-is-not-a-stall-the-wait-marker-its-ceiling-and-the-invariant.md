# 0150 — A delegation in flight is not a stall: the wait marker, its ceiling, and the invariant that is reading

Date: 2026-08-14
Status: accepted
Supersedes: ADR-0058 (its "the foreground requirement for applier and verifier is stated in both `plan` and `debug`" clause — that requirement named a mechanism this client has never carried, so what those two files stated was unfollowable rather than merely unenforced; the three forked skills' `background: false` pin and the `model: opus` reasoning that removed the pin from `plan` and `debug` while the forks keep it both stand), ADR-0145 (its Part 3 predicate, "when a turn ends without parking or closing the run" — a third class of healthy turn-end exists and that predicate reads it as a stall; Part 1's marker with both of its reader properties, Part 2's delivery carve-out entire, the byte-counted cap at three pushes, and above all Part 3's fail-open direction all stand, and this decision EXTENDS the last of them to its own new paths rather than moving it), ADR-0148 (its Part 3 clause "one that did not is a run being restarted into the same place", which the expired-mark class breaks, and its Consequences' "Two files, one location, one lifetime", which is three files now that the wait sidecar sits beside the journal and the push tally; the journal itself, its per-change keying, the three counts against the event log, the net's size-only read of it and the one lifetime those files share all stand)
Reconciled: elsewhere — it landed in one hook, both Claude platform bindings, the two neutral bodies, the gate table, the parity ledger and the linter, and the frozen body carries none of it. `plugin/hooks/auto-continue.sh` reads `auto_wait` off the state file it already read, holds the turn on a label that parses and records one `auto-continue-held` event, keeps the believed label in a `.waiting` sidecar beside the run journal whose mtime is the clock, and past `DELEGATION_WAIT_CEILING_MINUTES` pushes with `EXPIRED_DELEGATION_ORDER` and gives up with `EXPIRED_DELEGATION_CAP_MILESTONE`; `CONTINUATION_ORDER` gained the clause that forbids relaunching a delegation in flight. `plugin/skills/_shared/platform/claude/plan.md` and `platform/claude/debug.md` carry the `Making a launch wait` section whole — the background launch, the later-turn notification as the resume, the unread-report rule, the never-relaunch rule, the marker with its label pattern and its `none` sentinel, and the ceiling the net believes the mark for — while `platform/claude/quick.md` and `platform/claude/front-surface.md` point at that one statement instead of restating it and `platform/claude/reporting.md` names the marker as what the net reads where it used to push. `plugin/skills/_shared/bodies/plan.md`'s two launch rules and `bodies/debug.md`'s state the invariant as READING and hand the delivery mechanism to the platform file. `tools/hook-gates.txt`'s `SubagentStop` comment and `docs/parity-codex.md`'s launch-wait row and unattended-rails row carry the corrected host fact. `tests/plugin-lint.sh`'s `check_launch_wait_contract_states_the_mechanism_this_host_has` holds the section's clauses in both bindings and flags the retired flag anywhere under `plugin/skills`, with the ceiling clause derived from `DELEGATION_WAIT_CEILING_MINUTES` in the hook rather than typed into the rule. `plugin/bin/oso-state` and `plugin/hooks/lib.sh` are untouched, so `bootstrap/hook-hashes.txt` did not move and no Codex trust boundary was crossed.
Source: this change (stop-net-delegations); a real unattended run in another repository, which pushed itself twice inside one minute while its applier was working normally

## Decision

**A turn that ends because a delegation is still running is a third class of healthy turn-end, and the flow marks it so the net can tell it from a stall.** The net's direction is unchanged; what changes is the predicate it fires on and the host fact the contracts state.

### Part 1 — the defect: an order no client could follow, and a net that read the consequence as a stall

The Claude binding ordered `run_in_background: false` on every `Agent` launch. That tool's schema at client 2.1.232 is `{description, isolation, model, prompt, subagent_type}` under `additionalProperties: false`: there is no such parameter, an unknown one is rejected, and the tool's own result says the opposite of what the order assumed — the agent runs in the background and a completion notification arrives later. Every delegation therefore ended the turn, and ending it was correct.

The `Stop` net's whole predicate was that a turn ended without parking or closing the run, so it read that healthy turn-end as a stall. The cost is measured rather than feared: three pushes spent per slow delegation, a `cap reached after 3 pushes without progress` line written into the DURABLE run journal where it is false, and the net disarmed until the next real milestone reset the tally — so a run that later stalled for a real reason met a net that had already spent itself on a working applier.

The false premise lived in THREE places, and the third is why a reader could confirm it twice and still be wrong: both Claude bindings stated the flag, and `tools/hook-gates.txt` recorded "Claude launches these synchronously and needs no receipt hook" as the reason `SubagentStop` is unwired on that host. The gate table's conclusion survives the correction — Claude still needs no receipt — but the reason it recorded was the same false fact.

### Part 2 — the marker, and the binary it did not touch

`auto_wait=<label>` is written by the flow before a launch whose result arrives in a later turn, and returned to `auto_wait=none` once EVERY report for that label has been read. It is armed on every delegation and not only under `auto=running`: one unconditional rule survives a compaction where a conditional the orchestrator must re-derive does not, and nothing reads the key without the `auto` marker beside it, so an attended run pays the write and nothing else.

**The key cost `plugin/bin/oso-state` nothing, and that is load-bearing rather than lucky.** `set` validates no key names, so a new key is zero bytes in the binary and zero in `plugin/hooks/lib.sh`. Those two are published in `bootstrap/hook-hashes.txt`, and a change to either would have made this fix a re-trust through `/hooks` on Codex — the host that wires no `Stop` net at all and gains nothing from the change. A defect on one host would have charged the other host's trust boundary for its repair.

The reader-side constraint is the discipline ADR-0145 applied to `auto_change`, applied again for the same reason: the label is written by a model, so it is validated where it is READ. It matches `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`, `none` is the disarmed sentinel exactly as `active_slice`'s is, and anything else is ignored entirely. The KEY name itself is constrained from a different direction: `block-prod-deploy.sh` reads the whole state file as malformed unless every line matches `^([A-Za-z0-9_]+=|[[:space:]]*$)`, and an unusable state file DENIES there — so a key spelled with a hyphen would have armed a production-boundary refusal from the other side of the harness.

### Part 3 — the ceiling, and why an expiring mark does not lie

The net believes a mark for 45 minutes, measured from a HOOK-OWNED sidecar's mtime through `seconds_since_modified`. Neither of the two cheaper clocks measures the wait:

- **The state file's mtime** is refreshed by any `oso-state set`, and a run writes state for reasons that have nothing to do with the delegation. It would have measured the last state write.
- **A timestamp the flow writes** is the writer clocking itself. The mark exists because the flow can stop reporting; a clock inside that mark stops with it.

The sidecar carries the believed label as its content and the first sighting as its mtime, so the clock starts when the net FIRST SEES a label and not when the flow claims it did.

A push over an expired mark carries its own continuation order and its own give-up milestone, naming the stale mark instead of claiming there was no progress. That wording is not a nicety: half the original defect was a false sentence in the durable record, and a net that stopped believing a mark and then wrote the same false sentence would have fixed the pushes and kept the lie.

What makes an early expiry survivable is that nothing here reaches the subagent. **A push never touches a running delegation**, and the completion notification resumes the run even after the net has given up on the mark. Expiring early costs turns and never the run — which is why the ceiling is generous rather than tight, and why no path attempts to cancel anything.

### Part 4 — the invariant is READING, and delivery is the platform file's

The neutral bodies asserted host facts they had no standing to assert. The plan body required the report read "in the same turn" and claimed that "N launches in a single message all return in the same turn"; the debug body closed its wait rule by disqualifying "a host that cannot make one wait" — which, read literally, disqualified Claude Code from running the loop this harness ships for it.

What every host owes is one sentence: no step advances on a report nobody has read. HOW that report arrives — inside the launching turn, or as a notification that re-enters the conversation later — is the platform file's to state, exactly where ADR-0096 puts every other host fact. The bodies now state the invariant and name both shapes without picking one, and the one host that has a mechanism describes the mechanism it has.

That section was ungated prose, which is why it could go false and stay false across two releases. The linter's launch-wait rule pins its clauses in both Claude bindings and flags the retired flag anywhere under `plugin/skills`.

### Part 5 — the direction the net fails in is unchanged

ADR-0145 fixed that direction and this decision does not move it: **every path allows the stop, the new ones included** — an unreadable sidecar, one that cannot be written, an age that does not read back. A label that does not parse is no such path: the marker is ignored, its stale sidecar cleared, and the turn is pushed and counted exactly as an unmarked run — the net behaving exactly as it did at 0.24.0.

The hold is itself an allowed stop, and stating it that way is what keeps the fail-open argument intact. The net's only intervention was ever the PUSH; holding is declining to push, so the turn ends either way and no failure here can leave a session an operator cannot end.

## Context

The two halves of this defect were written months apart and neither is wrong on its own. ADR-0058 asked for a foreground delegation because an applier's report must be read before the verifier runs, which is right and still is. ADR-0145 pushed a run that ended a turn without parking or closing itself, which is right for every turn-end that existed when it was written. What made them collide is that the mechanism ADR-0058 named was never available, so the class of turn-end it was supposed to prevent existed on every delegation — and ADR-0145's predicate had no way to see it.

Three alternatives were rejected.

**Wiring `SubagentStop` on Claude and letting a receipt tell the net that work is live** was rejected because a receipt answers the wrong question at the wrong time. It fires when a delegation ENDS; the net asks its question at the `Stop` of the turn that LAUNCHED one, before any subagent has stopped, so the answer would be "none yet" on exactly the turns the net gets wrong. Codex's receipt exists because its wait operation needs proof of completion, which is a different question with a different answer.

**Reading the runtime triple instead of adding a key** — treating any turn under an armed `active_slice` as live work — was rejected because that flag is armed for the WHOLE slice, including every turn where the orchestrator is doing nothing at all. The net would have been disarmed precisely where it is needed, which is a slice that stopped moving. ADR-0144's argument against a fourth key was already retired by ADR-0145 on exactly the test that settles this one: a key earns its place when a hook reads it, and the net reads this one.

**Believing the mark until the flow clears it** was rejected on the failure it is defending against. The mark is written by a model and cleared by the same model; a run that dies between the arming write and the report read leaves the key at a label forever. A net that believes it forever has been disarmed by the one failure it exists for, and the trade is not close: the cost of a ceiling is turns, and the cost of none is the run.

## The ledger of what the rule cannot check

`check_launch_wait_contract_states_the_mechanism_this_host_has` holds the wait section's clauses in both Claude bindings, derives the ceiling from the hook rather than typing it, and flags the retired flag by its own spelling. Four things this decision rests on sit outside what it can answer:

- **The ceiling is matched as a NUMBER, not as a sentence.** The rule derives it from `DELEGATION_WAIT_CEILING_MINUTES` and requires both bindings to name that value, which closes the drift in both directions — a ceiling moved in the shell fails the rule, and text that drops it fails too. What it cannot see is meaning: a section naming the same number for something else would satisfy it, and nothing reads that the hook still multiplies that constant into the seconds it compares. The shared anchor helper's two ceilings (ADR-0141) apply here as everywhere.
- **The fail-open direction of the new paths**, which is the same standing ADR-0145 recorded for the old ones: no rule reads that hook's shell.
- **That the flow ARMS the marker at all.** A lint rule reads the instruction; nothing reads the runtime write, so a run that never armed the key meets a net behaving exactly as it did before the change — which is the fail-open direction paying for the gap.
- **The label's validation living in the reader.** A hook that trusted `auto_wait` verbatim would pass every rule this repo has, exactly as a `journal_file_for` trusting `auto_change` would.

## Consequences

- The net now has two give-up sentences and they claim different things. A `runs/` journal is readable as a record of WHY a run stopped rather than one sentence covering both causes — and the operator who finds the expired-mark wording knows to look for a delegation that never came back, which the old line would have hidden behind "no progress".
- `runs/<repository>/` holds three files per change now — the journal, the push tally and the wait sidecar — under one directory, one private mode and one lifetime, and `cleanup-state.sh` still touches none of them. ADR-0148's pairing argument holds at three for the same reason it held at two.
- A defect fixed only in a hook would have been invisible to the flow that caused it. This one is stated in the contracts the orchestrator reads BEFORE it launches, so the marker is armed by the flow rather than inferred by the net — and the hook stays a net rather than becoming the mechanism.
- ADR-0058's clause was retired by reading a schema, not by a change of mind. Its intent — the applier's report is read before the verifier runs — is what Part 4 states as the invariant, and it is enforced by the same flows that were already being asked for it.
- The two hosts' wait mechanisms are now different in KIND and equal under one invariant, and the parity ledger says so rather than resolving it: Codex waits inside the turn, Claude resumes on a notification and marks the wait its net reads. What Claude has instead of an error return is a mark that expires.
