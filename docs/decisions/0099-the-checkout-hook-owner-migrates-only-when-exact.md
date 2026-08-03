# 0099 — The checkout hook owner migrates only when exact

Date: 2026-08-03
Status: accepted
Amends: ADR-0051 (an oso-code-owned checkout path is not a foreign hook owner, but losing any sibling hook would still be an overwrite)
Implemented-in: docs/blueprint.md, docs/parity-codex.md, README.md, CHANGELOG.md, bootstrap/hook-hashes.txt, bootstrap/install-codex.sh, bootstrap/verify-codex.sh, tools/render-hooks-json.sh, tests/hooks-test.sh
Reconciled: applied — the Codex installer migrates the one exact, single-hook oso-code checkout path to its self-contained runtime and rejects every lookalike or mixed directory.
Source: the authenticated 0.18.0 installation smoke; this repository already carried the older `core.hooksPath=<checkout>/plugin/git-hooks` wiring

## Decision

The Codex installer may replace an existing `core.hooksPath` only when one unique local value names the absolute `plugin/git-hooks` directory below the checkout from which that same installer is running, the directory is not a link, its `pre-commit` is a regular executable rather than a link, the file matches the release-published hash, and the directory contains no other entry. This is migration of oso-code's earlier checkout-owned gate, not adoption of an operator or third-party hook.

The replacement points at the installed runtime copy and is reported explicitly. The transaction captures the earlier local Git value before any write, so a later failure restores the checkout path exactly.

Matching bytes alone never establish ownership. The same `pre-commit` copied to another directory remains foreign, as does the exact checkout directory after any sibling file, link or directory appears. Both cases keep the existing fail-loud policy; oso-code neither chains nor deletes the unknown owner.

## Consequences

- A repository already using oso-code's source hook upgrades to the relocatable runtime without a manual `git config --unset` gap in the commit rail.
- Moving the checkout later no longer breaks the installed gate.
- A third-party hook that happens to copy oso-code's bytes is not annexed.
- A mixed hook directory is preserved in full rather than reduced to oso-code's one published hook.
- This installation compatibility fix changes none of the five frozen Codex parity losses in ADR-0097.
