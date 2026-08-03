# 0098 — Codex configuration ownership is per leaf inside shared tables

Date: 2026-08-03
Status: accepted
Amends: ADR-0096 (the Codex installer distribution boundary — a host table is not wholly installer-owned merely because oso-code owns keys inside it)
Implemented-in: docs/blueprint.md, docs/parity-codex.md, README.md, CHANGELOG.md, bootstrap/install-codex.sh, bootstrap/lib/codex-managed-config.sh, bootstrap/lib/toml-regions.awk, bootstrap/verify-codex.sh, tests/hooks-test.sh
Reconciled: applied — the installer and verifier use a primary config region plus a leaf-level block inside the shared `[features]` table, preserving every unrelated feature key.
Source: the authenticated 0.18.0 installation smoke on a login-only Codex home; Codex had written `prevent_idle_sleep = true` before oso-code installation

## Decision

Installer ownership stops at the smallest TOML unit oso-code needs. The primary managed region owns oso-code's root setting and dedicated tables. The Codex-owned `[features]` namespace stays outside that region because the host and operator may add keys to it independently. Inside that table, a second bounded block owns exactly `hooks` and `multi_agent`.

An existing `[features]` table with unrelated keys is merged in place and preserved. If the table is absent, the installer creates it with its header outside the leaf block so a later host key has an unambiguous owner. Reinstallation removes and re-renders both oso blocks, leaving unrelated bytes in the shared table intact and producing the same file byte for byte.

A pre-existing `hooks` or `multi_agent` assignment outside the leaf block is a conflict even when its value already matches. The installer refuses it before calling Codex, Engram, npm or any plugin client: silently adopting the key would let a future uninstall erase configuration oso-code did not create. Malformed, duplicated or misplaced markers and TOML shapes that cannot be merged without changing ownership fail at the same boundary.

The post-install verifier checks both blocks independently and also proves that the leaf block is inside the one `[features]` table. Transaction rollback continues to restore the complete original `config.toml`, so a late failure cannot leave a half-adopted table.

## Consequences

- Normal Codex preferences such as `prevent_idle_sleep` coexist with oso-code and survive every reinstall.
- A new host feature key needs no oso-code change; ownership defaults to the host or operator unless a later ADR explicitly claims that leaf.
- The extra marker pair is deliberate complexity. It records the real ownership boundary instead of treating a shared namespace as a private file.
- This closes an installation compatibility defect; it changes none of the five frozen behavioral losses in ADR-0097.
