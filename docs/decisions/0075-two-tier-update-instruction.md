# 0075 — The update instruction is two-tier

Date: 2026-07-25
Status: accepted
Reconciled: elsewhere — landed in README.md and CHANGELOG.md; the frozen body's Distribution row names `/plugin` install/update as the mechanism, never the two tiers.
Source: this change (harness-hardening pass); recorded with the change that made it

## Decision

Updating takes two tiers, because the harness reaches a machine by two routes. `claude plugin update oso-code@oso-code` updates the plugin, and the marketplace entry's source is `./plugin`, so that subtree is the whole payload — skills, agents, hooks, git-hooks, `oso-state`, the output style, and the `.mcp.json` that carries context7 — which works from a marketplace install with no working copy of this repo at all. When a release's CHANGELOG entry is marked **Reinstall required**, `bootstrap/` changed and no plugin update carries it: pull the repo and re-run `bash bootstrap/install.sh`. Every release entry that changed `bootstrap/` now carries that marker.

## Context

Everything the installer puts outside the plugin — the `~/.claude/CLAUDE.md` block, the MCP wiring, the `core.hooksPath` gate, the Impeccable install, the legacy cleanup — is invisible to `claude plugin update`, so a single-line update instruction left every one of those stale.
