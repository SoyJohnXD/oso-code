# 0145 — The unattended run: the delivery carve-out, the marker, and the Stop net

Date: 2026-08-13
Status: accepted
Supersedes: ADR-0144 (its "no fourth key and no gate that reads one" clause — that reasoning was correct about a GATE and dated by a marker three hooks read; the runtime triple is still untouched and `mode=plan` still stands throughout), ADR-0032 (its delivery order as an unconditional absolute — the order stands for everything an operator must read and gains one marker-conditioned exception for a milestone), ADR-0115 (the same absolute as its Delivery section states it for a milestone report; every required fact, the length bound and the one-definition rule stand)
Reconciled: elsewhere — it landed in the skills, the output style and the hooks, and the frozen body never carried a delivery rule of its own (the same standing ADR-0032 has). The carve-out is granted once in `plugin/skills/_shared/reporting.md`'s Delivery section — the permission, what a host that takes it must state, the journal that replaces the interrupted stream, and the sentence that governs a host taking none — and stated whole in `plugin/skills/_shared/platform/claude/reporting.md`'s unattended-run section, with `platform/claude/plan.md`, `platform/claude/debug.md` and `platform/claude/roadmap.md` referencing that one statement rather than copying it. The marker's three values are written by `plugin/skills/_shared/bodies/plan.md`'s AUTO ground rule, its park bullet and §7's sequenced close; `bodies/roadmap.md` §4 arms the same marker per child and its blocked exit writes `auto=parked`. `plugin/output-styles/oso.md` and `bootstrap/claude-global.md` each carry the one marker-conditioned clause that keeps an always-loaded anchor from ordering the stall back. The net is `plugin/hooks/auto-continue.sh` on `Stop`, wired in `plugin/hooks/hooks.json` alone and recorded in `tools/hook-gates.txt` as Claude-wired; `plugin/hooks/lib.sh` gained `journal_file_for` and `plugin/bin/oso-state` the `journal` verb, so `bootstrap/hook-hashes.txt` moved with both. `tests/plugin-lint.sh`'s `check_unattended_run_carves_out_the_delivery_contract` holds the carve-out's nine clauses and all three marker values.
Source: this change (auto-continuity), decisions D1, D9, D13; a real run the operator left, which stopped at the first milestone it reported and was still sitting there when they came back

## Decision

**A run nobody is watching does not end its turn to report a milestone, and a marker on disk is what says a run is one.** The order every other delivery takes is unchanged; what changes is that it stops being unconditional for the one class of content produced by a flow with no operator standing at it.

### Part 1 — one marker, three values, beside the triple and never over it

`auto` is written by the flow and never by a hook: `oso-state set auto=running auto_change=<change-slug>` at §5's initialize or wherever a mid-execution flip is taken, `auto=parked` inside the park's single set-aside write, `auto=done` at §7's close. `mode=plan` throughout and the same three runtime keys §5 and §6 already write — a state write merges, so the marker stands BESIDE `mode`, `active_slice` and `verify_green` and overwrites none of them.

Two properties of the marker are the readers' rather than the writer's, and both matter more than the value:

- **Session-keyed.** Every reader requires the state file's `session` to equal the session id in its own payload before it acts on `auto=running`. A marker another session armed in this repository therefore arms nothing here — which is the same repository-keyed state file two agent sessions already share (ADR-0095), read the only way an unattended rail may read it.
- **A reader-validated slug.** `auto_change` is written by a model and used as a PATH COMPONENT, so it is validated where it is read and not where it is written: `journal_file_for` accepts `^[a-z0-9][a-z0-9-]{0,63}$` and falls back to the fixed name `run` on anything else, so a slug carrying a separator, a traversal or a control byte names a file inside the runs directory or names none at all. Validating at the writer would have put the check in the one place a marker can arrive without passing through.

What the marker buys is what a ledger line cannot: a host reads it. The disposition still LIVES in the change's ledger and the `oso/index` row's `NEXT:` line, exactly as ADR-0144 put it; the marker is not a second home for it but the arming surface those two have no way to be.

### Part 2 — the Claude delivery carve-out, and the two deliveries still outside it

While the marker reads `auto=running` for this session, operator-facing MILESTONE text does NOT end the turn: it rides the stream as the work happens and the next tool call follows it in the same turn. Everything else this host delivers is unmoved — a question round, a plan document and an approval gate all still end the turn, and none of them belongs to a run nobody is watching.

The cost is stated rather than denied. This TUI drops assistant text that precedes a tool call in the same turn, so a milestone delivered this way may never reach the screen at all. That cost is ACCEPTED because the stream was never the record: every milestone is also appended full-text to the run journal (ADR-0148), which is what makes a swallowed line a cosmetic loss instead of a lost report.

Two deliveries still END THE TURN under the marker and the list is closed at two: the PARK, and the run's own final report at §7's close. Each is the run handing itself back rather than a milestone going by. The close is SEQUENCED for exactly that reason — the disarm FIRST (`auto=done`, a tool call), the report after it as the same turn's trailing text — because text that FOLLOWS a tool call is delivered where text that precedes one may not be. Reversed, the close would deliver its account into the one gap this host is known to swallow, on the one turn the operator came back for. The final report the list names is the report of the RUN THE OPERATOR ARMED — a plain-AUTO change's §7 close, or a roadmap chain's own §5 report over its whole queue — so a roadmap CHILD's close is a milestone under the carve-out rather than a third turn-ender, riding the stream and the journal while the chain arms the next child in the same turn, exactly as ADR-0139 fixes a per-child close as none of the three moments allowed to interrupt an absent operator.

The carve-out is the HOST's and not the body's. The neutral contract grants the permission, states what a host taking it must state whole, names the journal as what replaces the interrupted stream, and closes with the sentence that governs a host taking none: every milestone ends the turn exactly as that section opens. Codex takes none, and the parity ledger records the asymmetry rather than a body implying it away.

### Part 3 — the Stop net, and the direction it fails in

`auto-continue.sh` is a `Stop` hook and a mechanical net, never a substitute for the contract above. It reads the same `auto=running` for the same session and, when a turn ends without parking or closing the run, answers `{"decision":"block", …}` with a continuation order naming where the position lives — the change's `oso/index` `NEXT:` line and `active_slice` — the journal append every milestone still owes, and the park route for a decision that needs the operator.

Its cap is on PUSHES WITHOUT PROGRESS, and progress is journal BYTES rather than turns: a tally file beside the journal remembers the push count and the journal's size at the last push, a journal that GREW resets the count to zero, and one that did not increments it. Three such pushes is the cap. Past it the net announces the give-up once — journaled, so the operator reads why the run stopped rather than inferring it — and allows the stop. Counting turns would have capped a run that is working; counting bytes caps a run that is only being restarted.

**Every failure path ALLOWS THE STOP**, and that direction is the whole safety argument: no session id, an unreadable cwd, no state file, a state file that cannot be read, a marker that is not running, a session that does not match, a tally file that is not a regular file, a count that does not parse, a tally that cannot be written. A net that failed CLOSED would hold a turn open on a state file it could not read, which is a session an operator cannot end. The runtime gates fail the other way for the opposite reason (ADR-0095): they deny work, and this one only declines to prolong it.

## Context

The order stood UNCONDITIONAL at every site that carried it — both hosts' always-loaded global sources, the output style, the neutral milestone contract, the plan body and every platform file that binds delivery — and it was right at all of them for as long as somebody was reading. What made it a defect rather than a rule is that the flows producing milestones are exactly the ones ADR-0136 and ADR-0144 wrote for an operator who is not there: an unattended run reports a milestone, the milestone ends the turn, and the turn ends in front of nobody.

The second half of the root cause is that two contracts were already jointly unsatisfiable and nothing had made them collide. `bodies/roadmap.md` requires the chain to arm the next child in the SAME BREATH as the close it reports, so that nothing waits on the operator; `platform/claude/plan.md` requires operator-facing content to END the turn with the tool call in a LATER turn. A milestone cannot both end the turn and share it with the arming that follows. With an operator present the contradiction costs a turn nobody notices; with none it costs the run, and no amount of care in either text was ever going to satisfy both.

Three alternatives were rejected.

**Reporting nothing while the marker is on** would have removed the conflict by removing the milestone. It was rejected because the operator's return is precisely when the account is needed, and a run that reported nothing is one whose whole execution is unauditable — the failure the milestone contract exists against (ADR-0115).

**Leaning on the net instead of the contract** was rejected as a stall wearing a restart. A flow that ends its turn per milestone and is pushed back into motion by a `Stop` hook has already stopped once per milestone and is spending its cap to do it; three pushes buys three milestones. The net exists for a turn that ended for a reason no contract predicted, not for the one every contract does.

**A single host-neutral carve-out** was rejected because the fact it rests on is a host fact. This TUI drops text preceding a same-turn tool call; the Codex adapter claims nothing about same-turn preservation and depends on none. A carve-out written once for both would have asserted a delivery property on a host that never promised it.

## The ledger of what the rule cannot check

`check_unattended_run_carves_out_the_delivery_contract` pins the nine clauses of the carve-out section whose absence is the defect and all three marker values in the plan body's ground rule. Four clauses of this decision carry no marker at all:

- **The SEQUENCE of the close.** The rule reads that `auto=done` appears in the carve-out section; a body that delivered the report and then disarmed would satisfy every marker and lose the report on the turn it matters.
- **The fail-open direction of the net.** No lint rule reads that hook's shell, and no marker distinguishes a net that allows the stop on an unreadable state file from one that blocks on it.
- **The session-keying of every reader**, which is the difference between a marker and a repository-wide switch.
- **The slug validation living in the reader.** A `journal_file_for` that trusted `auto_change` verbatim would pass every rule this repo has.

The shared anchor helper carries ADR-0141's two ceilings here as everywhere: each site is located by the lines that contain ONE anchor string, so a clause reworded off that line leaves the rule's sight, and markers are matched case-insensitively, so RUNNING, PARKED and END THE TURN are not enforced as capitals.

## Consequences

- The delivery rule now has a condition, and the condition is ARMED rather than assumed. Nothing reads differently for a run with no marker, which is every run before this change and every run an operator sits through after it — the exception cannot fire by inference, only by a write the flow made.
- A milestone under the marker may never be seen, and that is a real loss traded for a real one. What makes the trade payable is that the journal is written on the same line as the stream, so the surface that can swallow text is no longer the only surface carrying it.
- The `Stop` hook is the first hook in this harness that can prolong a turn, and its cap is what keeps that bounded. Three pushes without journal growth end it, the give-up is journaled, and every unreadable input ends it sooner.
- The two hosts diverge on continuity for the first time. Claude carves out the delivery rule and wires the net; Codex carves out nothing, so a milestone there still ends the turn and the run waits — recorded in `docs/parity-codex.md` as an asymmetry with the net named as a pending, never as a fact a body implies away.
- ADR-0144's fourth-key reasoning was retired by its own test rather than by a change of mind. It rejected a key because nothing would read one; three hooks now do, and the same sentence that retires it is what keeps the runtime triple out of the marker's way.
