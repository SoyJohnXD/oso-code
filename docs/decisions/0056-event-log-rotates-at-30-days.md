# 0056 — The event log rotates at 30 days

Date: 2026-07-25
Status: accepted
Reconciled: elsewhere — landed in the SessionEnd hook; the frozen body never carried retention.
Source: docs/blueprint.md amendment of 2026-07-25 (gates-hardening), decision (D15), deciding commit 7d52356

## Decision

At SessionEnd the event log rotates by atomic rename at 30 days.

## Context

Tagged to its own clause inside the audit-trail decision (ADR-0055), which is why it is its own record here.
