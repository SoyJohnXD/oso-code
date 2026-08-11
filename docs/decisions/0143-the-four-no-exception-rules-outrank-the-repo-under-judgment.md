# 0143 — The four no-exception rules outrank the conventions of the repo under judgment

Date: 2026-08-10
Status: accepted
Reconciled: elsewhere — it landed in the rubric and the plan body, and the frozen design never stated what a rubric rule outranks. `plugin/skills/_shared/rubric.md` carries the precedence as the judgment contract's last bullet — the four named, a conflicting pattern read as evidence about the repo rather than as a standing exception, the conflict routed to the operator as a QUESTION, and the doc-form carve-out disclaimed as an instance of a convention winning — and its System-level "One style per concern" bullet gains the bound that ends its deference at those four. `plugin/skills/_shared/bodies/plan.md` §2 gains step 6, a SECOND audit of the surface map against the four whose output is a battery question ranked with the rest, answered in Decision rounds and recorded in the ledger; and §6 step 3's ESCALATE route names the legacy-convention conflict as its canonical case, with the operator's two readings — keep the class's bar by fixing the slice, or amend the ledger explicitly. `tests/plugin-lint.sh`'s `check_no_exception_rules_outrank_repo_convention` holds all three parts, and `tests/hooks-test.sh` takes its mutation case at 1396 → 1397.
Source: this change (authority-plan-auto); the route ADR-0142 closed when it made a project's conventions an applier input alone, which left a repo whose existing pattern violates one of the four with nowhere legitimate to raise the conflict

## Decision

**The four rules the rubric puts outside its own judgment contract — the three Hard blockers and the inline-comment debt class — outrank the conventions of the repo under judgment.** A codebase whose existing pattern violates one of them does not soften it. The pattern is EVIDENCE about that repo, never a standing exception, and the conflict is a QUESTION for the operator.

### Part 1 — stated in the rubric, where the deference is also stated

The rubric had two clauses that pointed at a repo's own habits and neither said what happens when the habit is the banned thing. "One style per concern" told a change to follow the codebase's existing pattern instead of introducing a competing one — sound for a naming scheme, a test layout, an error-wrapping idiom, and a licence to keep swallowing errors if read past its subject. And the judgment contract required every finding to name a concrete readability win, which a lone finding against a repo-wide pattern struggles to do: the code IS consistent, and consistency is a readability argument.

The precedence therefore lands in both places. The judgment contract gains it as a bullet, which is where a reader looking for what overrides what already goes, and "One style per concern" gains the bound in its own sentence — a pattern that violates one of the four is not a style to follow, and the conflict goes to the operator as a question. Stating it once would have left the other clause reading exactly as it read before.

The bullet also disclaims the one thing it could be misread as licensing. The doc-form carve-out — the host language's standard public-API doc form — is NOT an instance of a convention winning: the debt class itself grants it, so it holds wherever that class does and nowhere a repo's own habit puts it.

### Part 2 — the conflict is found during planning, not discovered at a gate

§2's surface mapping AUDITS the map a second time, against the four. What the first pass produces is a map of what the change touches; what the second pass asks of it is whether the evidence shows a convention of the target repo in tension with one of the four — a comment register every file writes in, a pattern that swallows errors, secrets committed by habit. Where it does, the output is a battery QUESTION like any other: ranked into the same battery, carrying the consequence of leaving it undecided, answered by the operator in Decision rounds, and recorded in the frozen ledger.

The placement is the decision. A conflict found at planning time is one question in a round the operator is already sitting in. The same conflict found at a verify gate is a red slice, a relaunch and an escalation, and it arrives at the worst possible moment — when a writer has already written the code the convention asked for. Reading the repo settles none of it either way: those four outrank its conventions, so a convention in tension with one never rides silently into a payload as a "project convention", which is the door ADR-0142 closed from the receiving end.

### Part 3 — the escalate route names its canonical case

ADR-0141 left a no-exception finding two routes, FIX and ESCALATE, and stated ESCALATE in the abstract. The legacy-convention conflict is now named there as its canonical case — the one where the repo's own code does the banned thing everywhere, which is the case an orchestrator is most likely to talk itself out of escalating, because fixing one slice to a bar the rest of the repo ignores feels like the wrong answer.

Both readings go to the operator and the pick is theirs: keep the class's bar by fixing the slice, or amend the ledger explicitly. The second is a real answer and it is deliberately not the flow's to take — an amendment is on the autonomy policy's never-solo list (ADR-0136), so this route reaches the same place from the other direction.

## Context

Without a precedence, the four rules are absolute against everything except the one thing that can produce them at scale. A repo with a comment register in every file, or an error-swallowing idiom in every handler, presents a judge with a rule that says never and a codebase that says always, and nothing in the rubric ranked the two. That gap is not hypothetical about this class: it is the argument the field failure in ADR-0141's Source actually ran on, where the overrule was defended on the shape of the surrounding code rather than on the rule.

The alternative of letting the repo win — a convention as a standing exception — was rejected because it is the escape hatch ADR-0134 removed, re-entering through a different door. That decision refused a density threshold and an external-constraint exception on one test: an exception a reader can talk their way through is not a bar. "The repo already does this" is the easiest such reading there is, available in every legacy codebase, and it would have made the four rules hold only where they were never going to be tested.

The alternative of letting the JUDGE settle it silently — fail the slice and move on — was rejected as the wrong party. Whether a repo's pattern is a defect to correct or a constraint to plan around is a decision about the change, and decisions are the operator's; a judge taking it downstream is the same overstep as an orchestrator overruling a verdict, at a different point in the pipe. What ships is that the conflict is SURFACED at all three points where it can arise — the map, the rubric a judge reads, and the route a red verdict takes — and answered at exactly one, by the operator.

## The ledger of what the rule cannot check

`check_no_exception_rules_outrank_repo_convention` locates each of its three parts by a literal anchor, and the anchors are not matched the same way:

- **The rubric and plan halves match case-SENSITIVELY** (`grep -F` for the anchor, `grep -qF` for each marker), so a reword that keeps the clause in other words — or that changes a marker's capitals — fails, which errs toward flagging rather than toward missing one. The ESCALATE half rides `roadmap_exception_stays_bounded_in`, which matches case-INSENSITIVELY, so its four markers are the only ones of the rule's twelve whose capitals are not enforced. The mismatch is inside one rule, and a maintainer editing markers has to know which half they are in.
- **The precedence bullet is located by a long sentence fragment**, `outrank the conventions of the repo under judgment`. It anchors the clause to that wording, so the rule holds a SPELLING and not the ranking itself: a rubric that stated the same precedence in different words would fail the rule, and a rubric that kept the words while contradicting them in a later bullet would pass it. What the words rank is held by review, the same bound ADR-0140 records for the operator-rule guard.

## Consequences

- The rubric now ranks itself against something outside itself, which it never did before. Every rule beneath the judgment contract still yields to that contract, and the contract still yields to nothing — what is new is that the four rules the contract cannot reach also do not yield to the repo, and the sentence saying so lives next to the sentence that made the repo's pattern authoritative.
- A change into a legacy codebase now costs one question at planning time it did not cost before. That is the price, and it is paid in the round the operator is already in rather than at a gate they are not standing at.
- `/quick` and `/debug` do not get the second audit, because neither builds a surface map or a battery. The rubric precedence still binds every judge in both — what those flows lack is the planning-time route, so a conflict there surfaces at the gate and takes ADR-0141's ESCALATE.
- The doc-form carve-out is narrowed in exactly nothing and clarified in one sentence. It was always granted by the debt class rather than by a repo's habit, and ADR-0134 Part 1 already rested it on ADR-0005's stack-translation clause; saying so in the precedence bullet keeps the widest available misreading of that bullet closed.
- An operator can still decide that the repo wins. It is one of the two readings the ESCALATE route puts in front of them, and it lands as a dated ledger amendment beside the frozen entry — visible, attributable and made by the one party allowed to make it.
