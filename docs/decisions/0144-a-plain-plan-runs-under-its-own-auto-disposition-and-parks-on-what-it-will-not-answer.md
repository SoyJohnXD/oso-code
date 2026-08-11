# 0144 — A plain plan runs under its own AUTO disposition, and parks on what the policy will not answer

Date: 2026-08-10
Status: accepted
Reconciled: applied — `docs/blueprint.md`'s Mode 1 phase 4 states the one round of two questions and the three things it records, phase 3's "returns to the human" absolute names the AUTO run beside the roadmap with its two substitutions, and phase 7's close carries the machine entry condition for both and the one report a run under AUTO owes at whichever end it reached. The disposition is defined in `plugin/skills/_shared/bodies/plan.md`'s ground rules — the arming and disarming routes, the dated ledger record, the flip as its own consent, the phases AUTO does not govern, the absence of any fourth runtime key, the message rule, and the two substitutions that make "under a ROADMAP" readable as "under AUTO" — with §4's round asking it, the set-aside ground rule defining the PARK, and §7's close naming the three-part report. `plugin/skills/_shared/reporting.md`'s second bound exception generalizes to an absent-operator run's final report and names its two instances, with `tests/plugin-lint.sh`'s `check_milestone_reporting_contract_is_complete` widened to hold that paragraph's three markers. `check_auto_disposition_is_a_ledger_toggle_that_parks_on_a_question` holds all three sites in the plan body; `tests/hooks-test.sh` takes the disposition's mutation case at 1397 → 1398 and moves the milestone case with the exception, adding none for it.
Source: this change (authority-plan-auto); the operator asking for the roadmap's walk-away property on a single plan, without a fifth mode, a new runtime key, or a second copy of the roadmap's policy

## Decision

**A plain `/plan` change can run unattended under its own AUTO disposition, and PARKS on what the autonomy policy will not answer.** AUTO is a DISPOSITION of the run — never an invocation argument, never a fifth mode.

### Part 1 — armed two ways, disarmed the same two, dated in the ledger

AUTO is asked as the SECOND question of §4's execution-mode round, beside the sequential/parallel question and inside that same round rather than a round of its own, or flipped by explicit operator instruction at any point the flow reaches, mid-execution included. Both directions travel both ways. NORMAL is the default and the recommendation, on the plainest of grounds: AUTO buys nothing for an operator who is sitting there, and the one about to leave is the one who takes it.

Every flip is recorded DATED in this change's ledger, and **the flip itself is the consent** — nothing further is asked before it takes effect. A confirmation round on an instruction the operator just gave is a gate in front of the one action whose whole purpose is that they are leaving.

The disposition lives in that ledger and in the `oso/index` row's `NEXT:` line and NOWHERE else. `mode=plan` throughout, the same three runtime keys §5 and §6 already write, no fourth key and no gate that reads one. That is deliberate and it costs nothing: whoever resumes a parked run is present by definition, so §0's existing resume path is the resume path, and a runtime key would have been a fourth thing to keep honest for no gate that reads it.

**Phases 1–5 always run with the operator.** AUTO governs §6 and §7 alone. The intent, the map, the rounds, the slices and the approval are the exchange this mode exists for; a disposition that skipped them would be a different mode, which is the mode this decision deliberately did not add.

### Part 2 — the roadmap's policy, named rather than copied, read at this change's scale

What answers a decision in the operator's place while AUTO is on is the ROADMAP mode's own autonomy policy (ADR-0136) — named here, never copied. Its three tiers, its irreversibility bar and its never-solo list apply entire. One thing reads differently and it is the only one: where that policy reads a global ledger and a child's, this change's own frozen ledger answers first, because there is one ledger instead of two. Nothing else about it moves.

A copy would have been the duplication ADR-0115 and ADR-0139 both exist to prevent, and it would drift the first time either text moved. Naming it is also what makes the ground rules' final clause true: wherever `bodies/plan.md` reads "under a ROADMAP", a change executing under its own AUTO disposition reads the same way — which is what lets one body carry two absences instead of two parallel sets of instructions.

### Part 3 — exactly two substitutions, and the second one is the PARK

There are TWO substitutions and no third:

- **What a child queues for the roadmap's §5, this run queues for its OWN final report** — the three parts §7 delivers at the run's end.
- **Where the chain arms the next child behind a set-aside one, this run PARKS.** There is no next child.

Parking is the set-aside ground rule with that last step replaced, and nothing else about it changes. It reports BLOCKED carrying the queued question or questions exactly as they stood, delivers that same final report, writes the set-aside state (`oso-state set mode=plan active_slice=none verify_green=false`) over whatever the stopped slice or wave left armed, and ends the turn there. `oso-state clear` is no more run here than under a roadmap, and for one reason more: this run EXPECTS resumption, so its position stays durable in the change's ledger, in its plan topic and in its `oso/index` row, and the SessionStart stale-state notice already names this mode's own re-invocation as the way back through §0. **A park is an END OF THE TURN and never an abandonment.**

### Part 4 — a message does not disarm it, and only an explicit resume does

Two silent failures were available here and the rule closes both. AUTO must not die on a glance — an operator who answers a question the flow queued, or drops a comment on what they see, has not taken the run back — and the operator's return must not go unheard. So a queued answer is CONSUMED as operator input and the run continues under AUTO, a comment is attended and the run continues, and only an explicit resume instruction — "retomo yo" and its kin — hands the flow back.

### Part 5 — the reporting bound's second exception generalizes, and the list stays closed at two

`_shared/reporting.md`'s second exception to the three-line bound read "A roadmap's final report". It now reads **"An absent-operator run's final report"** and names its two instances: the ROADMAP mode's §5, over the whole queue of changes it ran, and a plan run under its own AUTO disposition, over the one change, at whichever end that run reached. The list of exceptions is still closed at two — the named residual and this one — and nothing else in either run is exempt, a child's disposition included.

This is a clause of THIS decision rather than a decision of its own, and the test is that it cannot be reverted or held on its own. Reverting it while AUTO stands would bind a whole unwatched run's account to three lines, which is Part 3's report unsatisfiable; holding it without AUTO would name a second instance that does not exist. It retires nothing: ADR-0139 recorded that a roadmap's final report is exempt from the bound, and it still is — what the paragraph gained is a second bearer under a heading wide enough to name both, which is why no `Supersedes:` line stands above.

## Context

The operator had the walk-away property in exactly one place and it was the wrong shape for the ask. The ROADMAP mode buys it by planning a QUEUE of changes in one sitting, which is the right trade for several changes and a large ceremony for one: a single substantial change would have to be dressed as a one-child queue, planned through a mode whose whole exchange is about ordering children and the entries that bind them, to reach a property that has nothing to do with queues. The property being bought is absence, and absence is not a queue's feature.

What made this cheap is that the plan body already had absence written into it. ADR-0136 and ADR-0137 gave that flow four exits for an operator who is not there, a policy that answers in their place, and a set-aside disposition for what the policy will not answer — all of it phrased "under a ROADMAP" because that was the only producer of absence at the time. So this decision adds a SECOND PRODUCER of the same condition rather than a second mechanism for it, and the ground rules say exactly that: absence has two producers, a missing operator and one who has stepped out, and the second costs this flow exactly what the first costs.

Three alternatives were rejected.

**A fifth mode** was rejected as the thing the ask was explicitly not. AUTO changes no phase, no gate and no artifact of `/plan`; it changes who answers a decision in §6 and §7. A mode duplicating five phases to alter the last two is the duplication the neutral bodies exist to prevent, and it would have needed its own wrapper, its own platform files, its own routing line on both hosts and its own row in every count this repo keeps.

**A fourth runtime key** was rejected because nothing would read it. The runtime triple gates commits and edits; the disposition gates nothing — it selects who answers a question. A key that no gate reads is a fourth thing to keep honest whose only failure mode is silent inconsistency, and the one durability the run actually needs is its POSITION, which the ledger, the plan topic and the index row already carry.

**A confirmation before AUTO takes effect** was rejected as self-defeating in the one case it would fire. The operator flipping it mid-execution is on their way out; the flip is the consent, and a gate in front of it is a stop in front of the instruction to stop stopping.

## The ledger of what the rule cannot check

`check_auto_disposition_is_a_ledger_toggle_that_parks_on_a_question` pins the clauses whose INVERSION is the defect — a flip nobody dated, a message that disarms, a copied policy, a fourth key, a park that clears state — and three clauses of Part 1 and Part 3 carry no marker at all:

- **"Phases 1–5 always run with the operator."** The bound on what AUTO governs is held by review; a body that let AUTO reach the decision rounds would pass this rule.
- **"The flip itself is the consent."** A body that added a confirmation round before arming would pass it too.
- **The `oso/index` row's `NEXT:` line**, one of the two places the disposition is allowed to live. The rule holds `` `mode=plan` throughout `` and `no fourth key`, which is the negative half of that clause; the positive half — where the disposition DOES live — is unheld.

Two ceilings come from the shared helper and are ADR-0141's: each of the three sites is located by ONE anchor line, so a clause reworded across two lines leaves the rule's sight, and the markers are matched case-insensitively, so AUTO, PARKS, BLOCKED, DATED and TWO are not enforced as capitals.

`check_milestone_reporting_contract_is_complete`'s widened half locates the exception by the literal `final report**` — the bolded lead of that paragraph — and asks three markers of it case-insensitively. It holds that BOTH runs are named there and it holds nothing about the bound they are excepted from, which the same rule's separate length-bound check reads independently.

## Consequences

- `/plan` has two dispositions and still one mode, one body, one set of phases and one runtime triple. The whole of what AUTO adds is one question in an existing round, one ledger field, and a park at the end of a route the flow already had.
- Absence now has two producers and one set of instructions. Every "under a ROADMAP" clause in `bodies/plan.md` serves both, which is what keeps the two from drifting — and it is also the cost: a future clause written for one of them has to be read against the other, or the two substitutions stop being exhaustive.
- An operator who parks a run gets a BLOCKED report with the questions as they stood, plus the full three-part account, plus a tree left exactly as the stopped work left it. Nothing is discarded and nothing is guessed, which is the same bargain ADR-0137 struck for a child, reached by a run that has no chain to hand off to.
- The run is unattended on BOTH hosts, and that is a parity fact worth stating because the neighbouring one reads the other way: a roadmap runs ASSISTED on Codex, since each child stops at that host's byte-exact approval prompt. A plain plan has ONE approval, which is the gate each host already has, so nothing per-slice stops for the operator after it and the walk-away property survives the Codex rail intact.
- The reporting contract's exception list is still closed at two, and it now names a shape rather than a mode. A third absent-operator run would join it as an instance rather than as a third exception — which is the property that made generalizing the heading better than adding a sibling paragraph beside it.
