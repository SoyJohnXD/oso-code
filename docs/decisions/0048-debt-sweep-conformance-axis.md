# 0048 — `debt-sweep` gains a ledger-conformance axis

Date: 2026-07-24
Status: accepted
Implemented-in: plugin/skills/plan/SKILL.md
Reconciled: applied — Mode 1 §7 carries the sweep's second axis.
Source: docs/blueprint.md amendment of 2026-07-24 (secfork-impeccable-pocock), decision (D6), deciding commit 7d52356

## Decision

`debt-sweep` reports a second axis, ledger conformance, in its own section with its own verdict (Unimplemented / Contradicts-decision / Scope-creep / Partial). It is fed the bare decisions plus scope and never the rationale — the `doubt-pass` anti-anchoring — and is skipped honestly when no ledger is provided. `/plan` §7 passes the base ref and the frozen ledger.

## Context

ADR-0062 later makes `/plan`'s close read both verdicts by name and rules that a skipped axis is never a pass.
