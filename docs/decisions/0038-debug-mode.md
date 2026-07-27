# 0038 — A third mode: `/debug`

Date: 2026-07-22
Status: accepted
Superseded-by: ADR-0058 (removes the `model: opus` pin), ADR-0069 (retires "the diagnosis packaged as its ledger" at the VERIFIER launch — the applier launch keeps it), ADR-0071 (retires the debt-sweep escalation as a replacement for the quality pass)
Reconciled: applied — Mode 3 IS this flow.
Source: docs/blueprint.md amendment of 2026-07-22 (debug-security-flows), decision (a), deciding commit e556769

## Decision

A new `/debug` mode (`oso-code:debug`, opus, model-invocation off) runs a reproduce-first triage arc — Reproduce, Localize, Reduce, Root-cause fix, Regression guard. No reproduction means no fix, so the flow stops with ranked hypotheses; an operator "fix on hypothesis" override is recorded in the diagnosis while the regression test stays mandatory. The diagnosis freezes as the triage exit bar — root cause, repro evidence, fix decision, named regression test, zero-warnings commands, any override. The fix is delegated, never inline: an `oso-applier` runs with the diagnosis packaged as its ledger, and an `oso-verifier` judges the named regression test through the existing failing-check contract (fails without the fix, passes with it). Close runs `oso-code:quality-pass`, escalating to `oso-code:debt-sweep` only when the fix sprawled across many files.

## Context

This entry is one of three the v0.15.0 commit annotated in place, so `git blame` reports that commit rather than this one; `git log -S` on the original text recovers `e556769`.
