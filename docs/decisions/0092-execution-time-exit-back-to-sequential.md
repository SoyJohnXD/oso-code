# 0092 — A degrading wave draws an offer to finish sequentially

Date: 2026-08-02
Status: accepted
Reconciled: applied — Mode 1 phase 6 carries the offer to finish the remaining slices sequentially.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

When a wave degrades — conflicts repeating, an integration gate that will not go green, a graph that turned out to be a chain with every remaining wave a width of one — the orchestrator names what it is seeing and OFFERS to finish the remaining slices sequentially, keeping everything already integrated. An offer, never an approval gate: the operator decides, declining continues in parallel, and the answer is recorded in the ledger.

## Context

The mode was chosen once, at §4, on a width computed before anything ran (ADR-0080); degradation is information that only arrives at execution time, and an execution that cannot act on it spends the rest of the change paying for a number that turned out wrong. It is an offer for the same reason ADR-0043's stop-the-line is one, and additive in ADR-0042's sense — it adds a branch and takes nothing away — since a gate here would be a second approval after ADR-0033's single one.
