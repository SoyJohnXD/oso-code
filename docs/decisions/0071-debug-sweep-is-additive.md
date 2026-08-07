# 0071 — `/debug`'s sweep offer is additive, with its own fix route

Date: 2026-07-25
Status: accepted
Supersedes: ADR-0038 (its debt-sweep escalation, which read as a replacement for the quality pass)
Superseded-by: ADR-0130 — retires only the "loops judge-to-fix until `Debt Sweep: clean`" clause, which that decision replaces with a severity band under a hard cap; the sweep's additive standing beside the quality pass, the no-ledger `Conformance: skipped` contract and the quality-pass re-run over whatever cleanup lands all still stand
Reconciled: superseded — Mode 3 §5 still reads the sweep as additive, never instead of the quality pass, but its loop now exits on ADR-0130's band, so the body deliberately reads otherwise on the "until `Debt Sweep: clean`" clause alone.
Source: this change (harness-hardening pass); recorded with the change that made it

## Decision

When the fix sprawled across many files, `/debug` offers `oso-code:debt-sweep` as well — ADDITIVE to the quality pass, never instead of it. On acceptance it is invoked with no base ref and no ledger, so it answers on the debt axis alone and returns `Conformance: skipped — no ledger provided` on the other. Here that skip is the CONTRACT, not a gap: `/plan` reads the same token as "the ledger never reached the ARGUMENTS" and invokes again, but debug has no ledger to have sent, so the token is the expected answer and never a re-invocation trigger. `Debt Sweep: findings` goes to `oso-applier` as a debt cleanup, loops judge-to-fix until `Debt Sweep: clean`, and then `oso-code:quality-pass` RE-RUNS over the cleaned code, because step 4's green gates on a `Quality Pass: passed` that postdates those edits.

## Context

The escalation as written traded the pass for the sweep, and a branch that did so could never reach the green its own step 4 requires.
