# 0066 — fallow is reported, never asserted

Date: 2026-07-25
Status: accepted
Supersedes: ADR-0019 (its "fallow present AND Connected" assertion)
Reconciled: applied — Bootstrap responsibilities item 2 reads fallow as wired for debt-sweep use but only reported.
Source: this change (harness-hardening pass); recorded with the change that made it

## Decision

`verify.sh` reports fallow on a `note:` line — connected or not, with the fix command — and never counts it. A `note:` is not a check: it moves neither `passed:` nor `failed:`.

## Context

fallow is the one OPTIONAL MCP: it needs Rust to build, the README requires Rust on no OS, `install.ps1` provisions none, and `install.sh`'s own wiring already records its absence without failing. A hard check here would make the documented one-step Windows path red by construction.
