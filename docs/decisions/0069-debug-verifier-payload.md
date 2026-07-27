# 0069 — `/debug`'s verifier launch names its whole payload

Date: 2026-07-25
Status: accepted
Supersedes: ADR-0038 (its "diagnosis packaged as its ledger" at the VERIFIER launch; the applier launch keeps that wording)
Reconciled: applied — Mode 3 §4 reads the four-part payload and the never-"as ledger" naming.
Source: this change (harness-hardening pass); recorded with the change that made it

## Decision

`/debug` launches `oso-verifier` with the fix criteria, the zero-warnings commands the diagnosis froze, the rubric path, and the frozen diagnosis itself as fix-decision context — under that name and never "as ledger", since this flow freezes none and the recorded fix decision is the narrower bar in a ledger's place. The verifier reruns those commands and reads that rubric itself, so a launch that withholds either answers `blocked` or judges against a bar it never saw.

## Context

`oso-verifier` fails a new abstraction that no ledger decision calls for; on an assignment that carries no ledger, the recorded fix decision is what it judges against instead, so the agent contract had to name both shapes.
