# 0028 — Decision rounds run on an invariant core plus derived categories

Date: 2026-07-21
Status: accepted
Supersedes: ADR-0027 (the audit-floor model)
Reconciled: applied — Mode 1 §3 reads as an invariant core with per-surface derived categories.
Source: docs/blueprint.md amendment of 2026-07-21 (repaso-categories-antiswallow), decision (D1), deciding commit 4cc2020

## Decision

Decision rounds run on an invariant core of five categories — Contracts, Architecture, Errors, Verification, Reuse — plus categories derived per change straight from surface evidence, each citing the surface that motivates it: infra surfaces derive rollback, cost and observability; front surfaces accessibility, responsive and state; data-touching surfaces data model, migrations and source of truth; auth and payments surfaces security; user-facing surfaces UX behavior. The core is the fallback question generator only when exploration surfaces nothing.

## Context

The model this replaces put a fixed category table over the battery as a blind-spot floor it never generated from.
