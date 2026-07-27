# 0020 — `oso-state` is reachable from every skill

Date: 2026-07-16
Status: accepted
Reconciled: elsewhere — landed in the hooks, the skills and bootstrap/verify.sh; the frozen body names the state files but not the binary's resolution.
Source: docs/blueprint.md amendment of 2026-07-16 (windows-install-behavior), decision (D2), deciding commit 2905cde

## Decision

A SessionStart hook (`persist-state-bin.sh`) exports `OSO_STATE_BIN=<plugin>/bin/oso-state` to `CLAUDE_ENV_FILE`, no-op safe; every skill invocation uses `"${OSO_STATE_BIN:-oso-state}"`; and `verify.sh` resolves the ACTIVE installed plugin version (the `installPath` recorded in `installed_plugins.json`, with a `sort -V` fallback) and round-trips `oso-state` through the exact skill form.

## Context

A skill that assumes the binary is on `PATH` works only where the installer put it there.
