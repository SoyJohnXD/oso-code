# 0139 — The presence phase is one ordered queue behind one report

Date: 2026-08-10
Status: accepted
Supersedes: ADR-0115 (two clauses alone — its "Five milestones" enumeration, which gains a sixth for the CHANGE level only a roadmap reaches, and its "the named residual — the one exception to both rules above", which becomes two exceptions under a closed list; that decision's required facts per milestone, its three-line bound, its one-platform-file-per-host binding and its one-definition-never-a-copy rule all stand unchanged)
Reconciled: applied — `docs/blueprint.md`'s Mode 4 phase 5 states the four classes, the ranking, the report's three parts and the three interrupts. The phase is `plugin/skills/_shared/bodies/roadmap.md` §5; `plugin/skills/_shared/reporting.md` carries the sixth milestone (a child's disposition, stream-only) and the roadmap final report's exception to the length bound, with `tests/plugin-lint.sh`'s `check_milestone_reporting_contract_is_complete` widened to that milestone's own required facts and to the exception by name; and `check_roadmap_presence_phase_declares_its_order_and_its_three_pushes` holds the classes, the reproducible order, the report's three parts and the three moments allowed to interrupt an absent operator.
Source: this change (roadmap-auto-mode); everything the chain could not answer and could not stop for, which without this phase would have been scattered across the children that produced it; ledger decision R6

## Decision

**Everything the chain would have put to the operator is consolidated into ONE ordered queue behind ONE report, delivered once on their return.** This is the flow's only return to them after the approval, and it is what lets a decision that needs them cost the chain nothing when it arises: the cost is paid here, in one sitting and against one queue.

### Part 1 — four classes, and the list is closed

Every item names the child it came from and the point in that child where it arose:

- **Every decision the policy queued instead of answering** — over its irreversibility bar, on its never-solo list, unjustifiable on the evidence in front of a tier, or a reconciliation between an inherited entry and the child's own contrary evidence. Each arrives as the QUESTION it was, with the options and tradeoffs the silent tier would have put to the operator, never as a summary of the impasse.
- **Every child a queued decision set aside**, as ONE item with the decision that set it aside rather than a second entry further down, so the question and what it cost are read together.
- **What stopped the chain**, where the tree bar refused an arming: the dirty checkout or the standing worktree that failed it, the child that left it, and every child the refusal set aside behind it. A standing worktree travels with its PATH, since no later teardown clears it.
- **Every child's own non-code pendings and named residuals** — the `PENDING:` rows and the residuals its judges left recorded, from the children that CLOSED as much as from the ones set aside. Each child's close already recorded them; what this phase adds is that they arrive TOGETHER.

### Part 2 — prioritized means ORDERED, and the order is a rule

The same run consolidated twice yields the same queue in the same sequence. Rank by what an item's answer RELEASES, most first, and break every tie by the queue's run order and then by the point inside that child where the item arose:

1. **What stopped the chain** — every child behind it went un-run.
2. **What set a child aside** — one child stopped, and the slices it never executed wait on this answer.
3. **What cost its child nothing** — queued mid-execution over something that child's progress did not wait on; it closed anyway, so the answer shapes what comes after it and releases nothing.
4. **What awaits their hand** — the pendings and the residuals, where nothing is blocked and the work is simply theirs.

A judgment call in that ordering would make the queue an artifact of whichever model consolidated it, which is exactly the property an operator auditing an unattended run cannot check.

### Part 3 — one report heads the queue, and it accounts where the queue asks

Three parts and no fourth, so nothing is written twice — a deferral is named here and put as its own question below:

- **What was decided for them, and on what rationale** — every decision the policy took, as the delegated mark already records one: the decision, the tier that answered it, and why that tier was the one reached. This is what the one approval actually bought, and reading it is how an operator audits a policy they declared before any of it happened.
- **What was deferred, and why** — every item the queue holds, each with the reason no tier took it.
- **What awaited their hand** — what no answer of theirs releases: the tree the bar refused, a standing worktree with its path, the un-run remainder of every set-aside child, and the pendings each close left.

### Part 4 — three moments may interrupt an absent operator, and a child closing is not one

The mode drives no notifier and claims no transport to any device. What it fixes is which moments the flow may STOP at, because a stop is the whole of what a notification is here, and there are exactly three: the roadmap COMPLETE, the presence queue READY, and the chain BLOCKED — the last being a stop no set-aside disposes of, because what stopped it was never a decision (a verifier that cannot verify at all is the shape of it, and no tier substitutes for a tool that will not run). The first two land in the same breath whenever the queue is not empty, and that is ONE stop and one report rather than two.

A per-child CLOSE is deliberately none of them, and neither is an arming, a verdict read or a judge's outcome: the chain arms the next child in the same breath, so nothing there waits on the operator, and a push per close turns a ten-child roadmap into ten interruptions that each say the same thing. Every one of those reaches the session stream and the chain runs on — which is what the reporting contract's new sixth milestone is for, at the CHANGE level rather than inside one: the child, which of the two words it ended on, the reason where the word is SET ASIDE, and what the chain arms next.

The final report is the one thing in this flow exempt from that contract's three-line bound, stated there as an exception rather than left to an agent inferring one from the fact that no bound could fit it. Nothing else in the run is exempt, a child's disposition included.

## Context

Without this phase the mode has no answer to the question its own autonomy creates. The policy queues what it will not decide and the chain sets children aside — and every one of those items sits inside the record of the child that produced it, where an operator returning to a ten-child run would have to assemble the queue themselves out of ten ledgers, ten index rows and a session stream. That assembly is work the harness created and then handed back.

The alternative of interrupting at each item was rejected on the mode's own premise: a flow that fetches the operator for every queued decision is a flow they cannot walk away from, which is the whole of what this mode sells. The alternative of reporting per child close was rejected for the same reason from the other end — ten closes is ten pushes that each say the run is still going.

## Consequences

- **One of R6's three producers has no mechanism, and this is where that gap is recorded.** R6 names three ways operator-hand work reaches this phase; two are enacted — a child's non-code `PENDING:` rows and its judges' named residuals — and the third, a slice DECLARED as the operator's own, has no producer anywhere in the harness. `bodies/plan.md` §4 states exactly four slice fields (Goal, Files, Verify, Depends-on) and none of them can mark a slice as work the operator must do by hand, so nothing can declare one. Adding a fifth field is a change to the plan mode's slice contract, its approval document and its verify bar — a plan-mode change of its own, not a clause of this one — so the class ships with two producers and the third named here rather than implied by a body that lists it.
- The queue's order is reproducible, which makes it auditable: an operator can re-derive the sequence from the rule and the run's own record, and a consolidation that puts a pending above a chain-stopper is a defect rather than a matter of taste.
- The report accounts and the queue asks, so a deferral appears once as an account and once as the question it is — deliberately, since the account is what the operator reads to judge the policy and the question is what they answer. Any other item appears exactly once.
- Three interrupts is a ceiling on this flow's claim, not on any host's notifier. The mode says which moments it stops at and says plainly that it drives no notification transport, so nothing in the record promises a phone that rings.
- ADR-0115's contract now has a milestone that only one mode can ever reach and a second exception to its bound. Both are stated in the shared file rather than in the roadmap body, because that file is the single definition and a mode-specific copy of a reporting rule is the duplication that decision exists to prevent.
