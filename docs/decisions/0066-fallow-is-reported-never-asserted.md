# 0066 — fallow is reported, never asserted

Date: 2026-07-25
Status: superseded
Supersedes: ADR-0019 (its "fallow present AND Connected" assertion)
Superseded-by: ADR-0128 — the whole of it: fallow is provisioned from its npm package at a pin on every host and counted like every other MCP, which removed the Rust prerequisite this decision's reasoning rested on
Reconciled: superseded — Bootstrap responsibilities item 2 reads fallow as asserted connected beside engram and context7, so the body deliberately reads the opposite of what this decided.
Source: this change (harness-hardening pass); recorded with the change that made it

## Decision

`verify.sh` reports fallow on a `note:` line — connected or not, with the fix command — and never counts it. A `note:` is not a check: it moves neither `passed:` nor `failed:`.

## Context

fallow is the one OPTIONAL MCP: it needs Rust to build, the README requires Rust on no OS, `install.ps1` provisions none, and `install.sh`'s own wiring already records its absence without failing. A hard check here would make the documented one-step Windows path red by construction.
