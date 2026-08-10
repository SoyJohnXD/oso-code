# 0137 — A queued decision sets its child aside, and costs the chain nothing

Date: 2026-08-10
Status: accepted
Reconciled: applied — `docs/blueprint.md`'s Mode 4 phase 4 names SET ASIDE as one of the chain's two words and Mode 1 §7's close now carries the machine entry condition that replaces the operator's "I am happy" under a roadmap. The disposition is defined in `plugin/skills/_shared/bodies/roadmap.md` §3's last bullet, read by §4's arming and consolidated by §5; `bodies/plan.md` carries the four exits it costs that flow — the applier's blocked route (§6 step 2), the merge conflict (§6 failure routing), the conformance triage and the sweep's exit bar (§7 step 3) — plus the ground rules that name the disarming write and forbid `oso-state clear`; and `tests/plugin-lint.sh`'s `check_roadmap_condition_never_loosens_the_operator_rule` holds the queued outcome half of the two texts that hand a decision to the operator, beside the policy half ADR-0136 records.
Source: this change (roadmap-auto-mode); four gates of the PLAN flow that had no reachable exit with no operator standing at them, and would have left a child sitting at one rather than reaching an outcome a chain can act on

## Decision

**A decision the autonomy policy will not answer is queued for the presence phase, and what queuing costs is paid by the CHILD it surfaced in, never by the chain.** The chain arms the next child either way. A child that cannot go further is SET ASIDE — carried no further, never executed — and both the question and the child reach the presence phase, as one item rather than two.

There are exactly TWO words a chain reads out of a child: CLOSED and SET ASIDE. There is no third, because a child that is neither is a child still running, and nothing else arms while one is.

### Part 1 — what a queued decision costs turns on where it surfaced

- **Queued while a child is still being PLANNED**, it stops that child where it stood. Mode 1's freeze needs no exception carved for a roadmap: its reconciliation checklist requires every question to map to a ledger decision, a delegated mark, or an N/A with a reason, and both answers this mode supplies are already one of those — an inherited entry is a ledger decision recorded as inherited, and a policy decision is the delegated mark that phase already writes. A QUEUED question supplies nothing to map, so the checklist refuses the freeze exactly as it would with the operator in the room. That refusal is a bound on the one approval, never an exception cut into the gate.
- **Queued while a child is EXECUTING, over something its progress does not wait on**, it costs that child nothing. Mode 1's execution-time decisions of that shape are OFFERS — stop-the-line on unrelated breakage, the exit back to sequential, the security review at the close — and an offer nobody is there to take is an offer not taken, which that mode's own declined-offer route already covers. The child runs on to its close and the item travels to the presence phase alone.
- **Queued while a child is EXECUTING, over something its progress DOES wait on**, it cannot be free and this mode pretends otherwise nowhere. The child is SET ASIDE mid-execution: the slices it already landed stay committed as its own execution left them, the ones behind them are never executed, and the chain arms the next child rather than standing in front of a stop only the operator can clear.

### Part 2 — the four exits, because four gates had none

Mode 1 is written for an operator standing at each of its gates. Four of them would otherwise have had a child waiting at one forever, so each now reaches one of the chain's two words:

- **The applier's blocked route** resolves each question with the policy in the operator's place, recorded in the change's own ledger — that record is what makes the relaunch a fresh applier over a ledger that MOVED, which is the whole reason the route relaunches at all, since a fresh applier over an unchanged ledger blocks in the same place. A question the policy will not answer is queued and the change set aside there.
- **A merge conflict** is the one gate that structurally needs the operator however plainly a tier would have picked a side: carrying a pick out is an EDIT, and the only writers this flow has are appliers carrying a slice, a cleanup or a judge's finding — never a conflict between two slices. It is queued with its files and slices, the tree and both halves' branches left exactly as git left them.
- **The conformance triage** takes the CODE-diverged reading through the existing fix route where a tier can justify it on the evidence, and queues the case where the DECISION is what moved: a ledger amendment is on the policy's never-solo list, and this triage is exactly where that list says the operator picks.
- **The sweep's exit bar at its cap** is inside what the policy may decide — each of the three routes is undone by an edit and a re-run, and a debt residual is not the security residual the never-solo list holds back — so the policy picks among the same three and the pick is recorded. Where no tier can justify any of them, the pick is queued and the change is set aside at the cap.

### Part 3 — a close that no longer waits for a sentence, and a set-aside that undoes nothing

Mode 1's close is entered "when the user says they are happy", and under a roadmap nobody is there to say it. It gains a MACHINE ENTRY CONDITION in their place, in the shape Mode 3's close already runs on: the change's last slice green, committed and marked, or the last wave's integration gate passed, with every slice of the plan marked. It is an entry and never a permission — the push, the PR and an accepted security residual stay the operator's on both routes.

A set-aside UNDOES NOTHING. The stopped work stays exactly where it stopped: committed slices stay committed, an applier's pending edits stay in the tree as its report described them, a conflicted merge stays as git left it, a wave's worktrees and branches stay standing. What is disarmed is only what the stopped work armed — `mode=plan active_slice=none verify_green=false` — and never `oso-state clear`, because the chain arms the next child in this same repository and the mode that child runs under has to stay written. What the next child inherits from a tree left that way is the chain's to judge, not this flow's (ADR-0138).

## Context

The rejected alternative is the one that looks cheapest: map a queued decision onto the DELEGATED mark Mode 1 already writes, and let the child run on. It fails on three counts. The mark records a decision TAKEN, and there is none — writing one puts a fiction into the ledger the sweep's conformance axis judges the code against. A slice nobody executes has no route through the apply → verify loop, so the change would carry a slice that is neither done nor open. And a traceless decision handed to the sweep manufactures work for a judge that cannot answer it either.

Stopping the CHAIN instead of the child was the other candidate, and it is the failure this whole mode exists to avoid: one unanswerable question in child two would leave children three through ten un-run and a session waiting for somebody who is not coming. The trade is stated rather than hidden — a queued decision can cost one child its remaining slices, and it never costs the queue behind it.

## Consequences

- The cost of the mode's autonomy is bounded and visible: at worst, one child per unanswerable decision goes no further. The presence phase reports each as ONE item with the decision that set it aside, so an operator reads what they are being asked and what it cost together, never as two entries in different parts of a queue.
- Nothing in Mode 1 changed for a change the operator is standing at. All four exits are additive: each existing route keeps its text and gains the one case that applies when the flow is a child, which is why the lint rule guarding the two operator-facing texts checks that the absolute instruction survives verbatim.
- A set-aside child leaves a dirty tree ON PURPOSE, which is exactly what makes the chain's pre-arming tree bar necessary rather than defensive. The two decisions are halves of one contract: this one refuses to clean up after a stop only the operator can clear, and ADR-0138 refuses to arm a child over what that leaves.
- Mode 1's close now has two entry conditions, and a reader of the heading alone would see one. The heading keeps the operator's sentence, because that is the entry for every change that is not a child, and the machine condition is stated immediately under it rather than folded into the heading.
- `Verify-exception` and the other recorded overrides are untouched: this decision adds an exit for a decision nobody can answer, never a way to pass a bar nobody ran.
