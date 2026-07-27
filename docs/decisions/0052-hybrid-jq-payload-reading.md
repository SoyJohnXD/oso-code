# 0052 — Payload reading goes hybrid: jq where present, pure bash where not

Date: 2026-07-25
Status: accepted
Supersedes: ADR-0002 (its "no runtime jq dependency" clause)
Reconciled: elsewhere — landed in plugin/hooks/lib.sh; the frozen body never restated the reader.
Source: docs/blueprint.md amendment of 2026-07-25 (gates-hardening), decision (D1), deciding commit 7d52356

## Decision

Hooks read their JSON payload with jq where it exists and with the pure-bash reader as fallback, emitting a `jq-absent` event so the degradation is measurable. A missing jq is never fail-closed.

## Context

A marketplace install never runs `install.sh`, and a GUI-launched macOS client lacks the Homebrew path, so fail-closed would deny every Bash and Edit in every session on those machines.
