# 0075 — The update instruction is two-tier

Date: 2026-07-25
Status: accepted
Superseded-by: ADR-0133 — retires only the single-command spelling of the plugin tier; a `claude plugin marketplace update oso-code` now comes first, because the client installs from its own clone of the marketplace and an update alone reinstalls whatever that clone already holds. The two tiers themselves, the `./plugin` payload boundary and the **Reinstall required** marker on every release whose `bootstrap/` moved all still stand
Reconciled: elsewhere — landed in README.md and CHANGELOG.md; the frozen body's Distribution row names what a release packages and says nothing about how an installed one is updated, so neither tier appears in it.
Source: this change (harness-hardening pass); recorded with the change that made it

## Decision

Updating takes two tiers, because the harness reaches a machine by two routes. `claude plugin update oso-code@oso-code` updates the plugin, and the marketplace entry's source is `./plugin`, so that subtree is the whole payload — skills, agents, hooks, git-hooks, `oso-state`, the output style, and the `.mcp.json` that carries context7 — which works from a marketplace install with no working copy of this repo at all. When a release's CHANGELOG entry is marked **Reinstall required**, `bootstrap/` changed and no plugin update carries it: pull the repo and re-run `bash bootstrap/install.sh`. Every release entry that changed `bootstrap/` now carries that marker.

## Context

Everything the installer puts outside the plugin — the `~/.claude/CLAUDE.md` block, the MCP wiring, the `core.hooksPath` gate, the Impeccable install, the legacy cleanup — is invisible to `claude plugin update`, so a single-line update instruction left every one of those stale.
