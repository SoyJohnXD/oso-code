# 0036 — Forked `doubt-pass` before the freeze

Date: 2026-07-21
Status: accepted
Reconciled: applied — Mode 1 §3 carries the optional pre-freeze doubt pass on its three triggers.
Source: docs/blueprint.md amendment of 2026-07-21 (osmani-hardening), decision (D2), deciding commit d51ad79

## Decision

A new forked `doubt-pass` skill (`context: fork`, agent general-purpose, model opus — the debt-sweep mechanism) runs a pre-freeze adversarial review of the bare decisions: intent, surface map and decisions, never the rationale or the rejected alternatives, so the reviewer doubts rather than validates. `/plan` §3 offers and recommends it only when a derived category came from a migrations, security or rollback surface. The orchestrator reconciles its findings against the stored rationale — noise the rationale already answers versus actionable, actionable resolved like §6 blocked questions — over a single pass with operator re-run, a hard cap of three cycles, and a doubt-theater signal when two or more cycles surface nothing.

## Context

Withholding the rationale is structural anti-anchoring, not secrecy: a reviewer handed the author's reasoning validates it.
