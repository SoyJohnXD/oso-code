# 0027 — Surface mapping before the question battery, and `oso/index` recall

Date: 2026-07-06
Status: accepted
Superseded-by: ADR-0028 — retires only the category table's demotion to a blind-spot audit floor; the surface-mapping phase, the evidence rule and the recall convention still stand
Reconciled: applied — Mode 1 §2 carries the Explore-built surface map and §0 the `oso/index` recall.
Source: docs/blueprint.md amendment of 2026-07-06 (plan flow), deciding commit 6af5a9c

## Decision

`/plan` gains a Surface mapping phase between Intent and Decision rounds: up to three parallel `Explore` subagents build an evidence-based map of what the change touches from the approved intent, and the question battery is generated from that map. The Decision-rounds category table is demoted from question generator to blind-spot audit floor, generating questions only when exploration surfaces nothing. Every question in the battery cites the code evidence that motivates it and the consequence of leaving it undecided. Engram recall gains a single `oso/index` observation — one upserted row per change, `status: executing` at Slicing and `status: done` at Close — so resuming means searching the index first instead of guessing topic keys, with a direct topic-key search as fallback. Every `mem_save` on a ledger, plan or summary carries a rich title (`{topic key} — {human description}`); `/quick` summaries follow the same rule but are never added to the index.

## Context

This decision is filed ten days out of order in the log it came from — it sits between the 2026-07-16 and 2026-07-21 entries. A filing error, not a decision: nothing reads that log positionally, and its id here follows creation order like every other.
