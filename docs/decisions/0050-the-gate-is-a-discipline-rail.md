# 0050 — The gate is a discipline rail, not an adversarial boundary

Date: 2026-07-25
Status: accepted
Reconciled: nowhere — a framing decision; it directed where the audit's spend went and no file states it as a rule.
Source: docs/blueprint.md amendment of 2026-07-25 (gates-hardening), decision (D14), deciding commit 7d52356

## Decision

The gate is a DISCIPLINE RAIL for a cooperative agent, never an adversarial boundary: it consults a flag the gated party writes through an ungated command, and nothing binds `verify_green` to what was actually verified. So the spend goes to closing ACCIDENTAL bypasses, never to chasing deliberate ones.

## Context

The framing every other decision in this entry rests on, recorded so a future reader does not mistake the rail for a security control.
