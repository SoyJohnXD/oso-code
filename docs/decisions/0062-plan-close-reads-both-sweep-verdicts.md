# 0062 — `/plan`'s close reads both sweep verdicts by name

Date: 2026-07-25
Status: accepted
Reconciled: applied — Mode 1 §7 carries the two conformance dispositions, the `Unimplemented` return to §6, and the skipped axis that blocks the green.
Source: docs/blueprint.md amendment of 2026-07-25 (c-mechanisms), decision (d), deciding commit 7d52356

## Decision

`/plan`'s close reads `Debt Sweep: clean` or `findings` on one axis and `Conformance: clean`, `findings`, or `skipped — no ledger provided` on the other. A skipped conformance axis is never a pass — it says the ledger never reached the invocation's ARGUMENTS and the axis did not run — so it blocks the `verify_green` write. Conformance findings go to operator triage one at a time, each presented with its two readings for the operator (never the orchestrator) to pick between: the CODE diverged from the decision, and the fix goes to `oso-applier` as judge findings; or the DECISION changed during the work, and the ledger is AMENDED by a dated entry appended beside the frozen one (`mem_update`, merge and never overwrite), never an edit of it, because §8 puts that ledger in the PR body as the reviewer's evidence and a decision quietly rewritten to match the code turns that evidence into a copy of what it was meant to judge; the re-invocation then restates the ledger AS IT STANDS. `Unimplemented` never takes that route — a decision with no trace in the diff is a slice's worth of work missing, so it returns to §6 as its own slice with its own failing check, since this close path has no slice activation, no `oso-verifier` and no failing-check gate.

## Context

Extends ADR-0048, which added the axis without saying how the close reads it. ADR-0071 later gives `/debug` the same token with the opposite meaning, since debug has no ledger to have sent.
