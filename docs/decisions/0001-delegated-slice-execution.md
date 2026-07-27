# 0001 — Delegated slice execution

Date: 2026-07-02
Status: accepted
Reconciled: applied — Mode 1 §6 carries the per-slice applier/verifier delegation and the orchestrator's never-writes-during-execution rule.
Source: docs/blueprint.md amendment of 2026-07-02 (execution model), deciding commit 667388d

## Decision

`/plan` execution is delegated, gentle-style: an `oso-applier` subagent per slice — fed the frozen ledger, blocked-and-return instead of assuming, with the orchestrator resolving questions with the human and relaunching fresh — and an `oso-verifier` subagent per slice with no edit tools, rerunning every check independently and gating `verify_green` on a verdict with evidence. The orchestrator never writes code during execution. `/quick` remains inline.

## Context

An operator decision. The never-writes invariant is narrowed exactly once, by the design-foundation slice of ADR-0046, which is scoped to Impeccable's design-doc generation and nothing else.
