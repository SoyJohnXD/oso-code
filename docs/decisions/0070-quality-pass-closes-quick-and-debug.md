# 0070 — `quality-pass` closes quick and debug, never plan

Date: 2026-07-25
Status: accepted
Reconciled: elsewhere — landed in plugin/skills/quality-pass/SKILL.md; the frozen body names each mode's own close.
Source: this change (harness-hardening pass); recorded with the change that made it

## Decision

The `quality-pass` description names the modes that actually invoke it — quick and debug — and its project-bar step reads the checks the diagnosis froze when in debug mode, plus the two resolved Impeccable numerals it recorded on a front-surface fix. `/plan` closes through `oso-code:debt-sweep`, not through this skill.

## Context

The old wording named plan instead of debug and dates to the initial harness commit `1ecac78`, before `/debug` existed; no amendment ever decided that pairing, so this decision records the correct one rather than retiring a filed one.
