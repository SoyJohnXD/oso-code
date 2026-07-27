# 0072 — The marketplace source is classified, warned about, and repaired only with consent

Date: 2026-07-25
Status: accepted
Reconciled: elsewhere — landed in bootstrap/install.sh; the frozen body names distribution, never the registration path.
Source: this change (harness-hardening pass); recorded with the change that made it

## Decision

`install.sh` reads which source the `oso-code` marketplace is registered from. A local `directory` source is WARNED about — `claude plugin marketplace update` refreshes nothing there, and `claude plugin update` installs whatever that working tree holds — and repointed at GitHub only when GitHub is reachable AND the operator says yes; "no" is a supported answer, not an abort. A failed `claude plugin marketplace add` is classified off the client's own report (`policy-blocked`, `invalid-source`, `invalid-manifest`, `unreachable`, anything else `unknown`), and only `unreachable` falls back to registering the local clone, which warns that the plugin now loads from that working tree, edits and all. A client too old to answer which source is registered reads as "no local clone", since refusing to install would be the worse failure of the two.

## Context

This plugin is developed from exactly such a clone, where an unasked repoint would swap unreleased edits for the published release.
