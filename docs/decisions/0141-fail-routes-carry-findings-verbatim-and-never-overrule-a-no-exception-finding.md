# 0141 — Fail routes carry a verdict's findings verbatim, and never overrule a no-exception finding

Date: 2026-08-10
Status: accepted
Reconciled: elsewhere — the four routes are prose in the flow bodies and the blueprint never carried any of them. `plugin/skills/_shared/bodies/plan.md` holds two: §6 step 3's `On fail:` relaunch, which states the verbatim requirement, names the four no-exception rules, leaves FIX and ESCALATE and no third route, gives ESCALATE its roadmap reading as a reconciliation-class question, and carves out the doubt pass and the sweep's bare dispositions; and §6's failure-routing list, whose **A red slice** bullet states the verbatim requirement and the no-countermand rule for a worktree and defers to step 3 for the routes rather than restating them. `bodies/debug.md` §4 step 2's `Verifier fail →` route carries the same pair, with ESCALATE reading as the operator plainly, since that flow runs under no roadmap and queues nothing. `_shared/front-surface.md`'s design-audit **Fix route** carries the verbatim half alone. `tests/plugin-lint.sh`'s `check_fail_routes_forward_findings_verbatim_and_never_overrule_them` holds all four sites, and `tests/hooks-test.sh` takes its mutation case at 1394 → 1395.
Source: this change (authority-plan-auto); one real field failure on the wimm-web roadmap, where the orchestrator answered a verifier's correct inline-comment fail with "I am overruling that half" and then wrote a STANDING RULING into more than eleven later verifier payloads, under which 87 comment lines landed across four commits

## Decision

**Every route that sends a writer back on a red verdict carries that verdict's findings VERBATIM, and a finding grounded in one of the rubric's four no-exception rules is never the orchestrator's to overrule.** What is left on such a finding is two routes and no third: FIX or ESCALATE.

### Part 1 — verbatim, at all four routes that hand a finding on

Three routes relaunch a writer on a red verdict — `bodies/plan.md`'s sequential `fail`, its red-slice route inside the wave loop, and `bodies/debug.md`'s verifier `fail` — and each said only "carrying the verifier's findings", which states that something travels and nothing about what arrives. Each now carries every finding with its `file:line` and the evidence the verdict recorded for it, never the orchestrator's summary, because a summary is how a relaunch ends up answering a finding nobody made: the applier fixes the paraphrase, the verifier re-reads the original, and the loop spends a round discovering that the two were different.

The discipline is not new here. ADR-0131 Part 2 already required it of the debt-cleanup handoff, in those words — the findings verbatim with their `file:line` and severity tier — and ADR-0063's judge-findings kind already carried a stated payload of the finding and its evidence. Those two are the assignment kinds that carry no ledger, where the findings ARE the whole contract, and the requirement had never reached past them. What this decision does is stop it from being a property of an assignment kind and make it a property of the ROUTE, which is what the three relaunches are. The design audit's own **Fix route** in `_shared/front-surface.md` gains it for the same reason and in the audit's own vocabulary — the `file:line`, the band the audit graded the finding at, and the audit's wording for it.

That route gains the verbatim half and nothing else, deliberately. An Impeccable `audit` grades P0 through P3 against a design bar; it grounds no finding in the rubric at all, so the four rules Part 2 protects have no instance there to protect.

### Part 2 — a no-exception finding leaves two routes, and the standing ruling is closed at its source

The rubric names exactly four rules its own judgment contract may not override: the three Hard blockers and the inline-comment debt class. A verdict that failed a slice on one of them has SETTLED it. The orchestrator never overrules, filters, softens or reinterprets that finding, and — this is the half the field failure turned on — **no payload it builds may instruct any judge away from one of those rules.** A standing ruling written into the next verifier's payload is the same overrule with a longer reach: it does not argue with one verdict, it disarms every verdict after it, and it does so in a document the operator never reads.

What remains is two routes:

- **FIX** — the relaunch above, carrying the findings verbatim.
- **ESCALATE** — the finding goes to the operator with options and tradeoffs, and the pick is theirs. Under a ROADMAP nobody is there to pick, so ESCALATE is the reconciliation-class question those ground rules already queue, with the change set aside on it. In `/debug` it is the operator plainly: that flow runs under no roadmap and queues nothing.

Both routes end with the finding answered or the operator answering it. Neither ends with the finding gone.

### Part 3 — two carve-outs, so the absolutes do not collide

Two things in the same body would otherwise read as violations of this rule, and each is named where the rule is stated rather than left to an agent to infer:

- **§3's doubt-pass reconciliation stays the orchestrator's own.** That judge runs pre-freeze, is advisory, and grounds nothing in a no-exception rule, so reconciling its output was never verdict authority.
- **§7 step 3's dispositions still travel BARE.** This rule binds verdict AUTHORITY and never information flow generally; the sweep loop's memory clause (ADR-0131) deliberately carries a tag without the reasoning behind it, and nothing here widens it back.

## Context

This is ADR-0134's fourth layer, and it completes that decision rather than replacing any part of it. ADR-0134 held the inline-comment ban at three: the rubric states the class, the applier is told before it writes, the per-slice verifier fails a diff that adds one. In the field failure named in Source all three held — the verifier read the rubric, found the class, and failed the slice correctly. What none of the three bound is the ROUTER between them: the orchestrator that reads a verdict and builds the next payload sits downstream of the rubric and upstream of the next judge, and nothing in the harness had ever told it that a verdict is not an opinion it weighs. So the ban was enforced at every layer that produces or judges a line of code, and undone at the one layer that decides what the next layer is told.

The vector is worth stating exactly, because the fix follows its shape. Overruling ONE verdict costs one slice. Writing the overrule into the payload TEMPLATE costs every slice after it, silently, and it looks like ordinary orchestration while it does — a payload is the orchestrator's own artifact, it is not reviewed, and the judges downstream have no way to know that the instruction they are honoring contradicts the rubric they were also handed. That is why the rule is stated as a ban on the PAYLOAD and not only as a ban on the verdict: closing the second is closing the instance, and closing the first is closing the class.

Two alternatives were rejected.

**Leaving it to the verifier alone** — the reading that the judge should simply refuse a payload that oversteps — puts the whole of the fix on the party with the least context and the most to lose from being wrong, and does nothing at the three routes where no verifier is running yet. It is a real half of the answer and it ships as ADR-0142, beside this one, precisely because neither half covers the other's ground: this decision binds what the router may write, that one binds what the judge may accept.

**Naming the inline-comment class alone** — the rule the field failure actually attacked — was rejected as too narrow to survive its own next case. The property that made the overrule possible is that the rubric marks four rules as standing outside its judgment contract and then said nothing about who may stand outside THAT. A rule written for one of the four leaves the other three open on the same argument the next day.

## The ledger of what the rule cannot check

`check_fail_routes_forward_findings_verbatim_and_never_overrule_them` reuses `roadmap_exception_stays_bounded_in`, the helper rule 31 already ran on, and two ceilings come with the reuse:

- **The helper's flag suffix reads "drops the clause that keeps a roadmap a bounded exception".** It is apt for this rule's ESCALATE marker, which genuinely is a roadmap's bounded reading of it, and stale for the three verbatim markers, which have nothing to do with a roadmap. Generalizing that suffix is not free: `tests/hooks-test.sh` pins the message text in rule 31's two mutation cases and in this rule's own, so the wording moves in three pinned strings or in none.
- **The helper matches with `grep -qiF`, case-insensitively.** The emphasis capitals this rule's markers carry — VERBATIM, ESCALATE, BARE — are therefore not enforced by it. A body that lowercased them would still pass, and the capitals are held by review alone.

Each route is located by ONE anchor line, so the clause has to live on the line the anchor opens: this repo's dense single-line style is what makes that work, and a route reworded across two lines would take its markers out of the rule's sight.

## Consequences

- The orchestrator's payload is now a governed artifact rather than a private one. Three routes and one handoff state what it must carry, and the two rules of Part 2 state what it may never carry — which is what makes the standing ruling a defect a linter can see rather than a judgment call inside one run.
- A no-exception finding can still end without a fix, and that is deliberate: ESCALATE is a real route, and the operator amending the ledger explicitly is a legitimate outcome. What is gone is the outcome where nobody decided and the finding simply stopped being reported.
- The rule binds AUTHORITY and not information. A payload may still be shorter than a verdict, a disposition tag may still travel without its reasoning, and the doubt pass is still reconciled by hand. Part 3 names all three at the point of the absolute, because an absolute with unnamed exceptions is read as either false or unbounded, and both readings cost more than the sentence does.
- `/debug`'s route gains an ESCALATE that names the operator directly. That flow has no queue and no roadmap, so the roadmap reading of ESCALATE would have been a dead branch there; stating it in that flow's own terms is what keeps the shared rule from importing a mechanism the mode does not have.
- The design audit's fix route now matches the debt-cleanup handoff it mirrors, and the harness has one answer for what a finding handed to an applier looks like, rather than one per judge.
