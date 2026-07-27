# 0063 — `oso-applier` takes a closed list of four assignment kinds

Date: 2026-07-25
Status: accepted
Reconciled: applied — Mode 1 §7 reads debt findings and judge findings as distinct assignments with distinct permissions.
Source: docs/blueprint.md amendment of 2026-07-25 (c-mechanisms), decision (e), deciding commit 7d52356

## Decision

`oso-applier` enumerates a CLOSED list of four assignment kinds — a plan slice, a debt cleanup, judge findings, a diagnosis packaged as a ledger — each carrying its own permission to change behavior. Judge findings MAY change behavior inside the scope of the finding they resolve (a design finding IS a change to rendered output, a conformance finding a change to behavior) where a debt cleanup may not, and that payload is self-contained (the finding, its evidence, the touched files, the conventions, the rubric path) and requires NO ledger — a missing ledger is never itself a reason to report blocked. A payload matching none of the four is an error, never a fifth kind to infer.

## Context

The applier had one contract written for plan slices and three callers handing it something else.
