# 0054 — Gate polarity and state discipline

Date: 2026-07-25
Status: accepted
Reconciled: applied — the Hooks section carries the `active_slice=none` sentinel and the allow-silently-when-absent, deny-when-armed-and-unreadable polarity.
Source: docs/blueprint.md amendment of 2026-07-25 (gates-hardening), joint marker (D5/D6), deciding commit 7d52356

## Decision

An absent state file allows SILENTLY, forever — what keeps the harness invisible in the majority of sessions on a machine that merely has the plugin installed, and it must never change — while armed-but-unusable (a directory, unreadable, a grep read error) denies and logs. The edit gate's state-directory exemption is deleted: zero callers, and its unnormalized prefix glob was the `../..` bypass. Every state write carries the full triple with an explicit `active_slice=none` sentinel the gate treats as disarmed, arming reads the state back, and abandoning a mode mid-flow runs `oso-state ... clear`.

## Context

Filed under one marker covering two numbers, and the entry never separates them: the polarity and the state discipline that makes it decidable are one decision.
