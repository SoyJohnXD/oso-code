# 0019 — MCP wiring goes hybrid and durable

Date: 2026-07-16
Status: accepted
Superseded-by: ADR-0066 — retires only the "fallow present AND Connected" assertion; the wiring and the accumulate-then-summarize installer policy still stand
Reconciled: superseded — Bootstrap responsibilities item 2 reports fallow instead of asserting it, the shape ADR-0066 left.
Source: docs/blueprint.md amendment of 2026-07-16 (windows-install-behavior), decision (D3), deciding commit 2905cde

## Decision

context7 rides the oso-code plugin's own `.mcp.json` and auto-registers on install — the engram mechanism, which is what makes its tool names `mcp__plugin_oso-code_context7__*` — fallow is provisioned by the installer (cargo or prebuilt, plus `claude mcp add`), and the redundant user-scope context7 is migrated away. The installer never aborts on an MCP failure: it accumulates failures and prints an end-of-run per-server summary (OK/FAILED, reason, manual fix), and `verify.sh` asserts engram, context7 and fallow present AND Connected.

## Context

Durable means a fresh session finds the servers wired without a second manual step.
