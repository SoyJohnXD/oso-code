# 0059 — The Impeccable pin is resolved at runtime from the npm channel

Date: 2026-07-25
Status: accepted
Supersedes: ADR-0046 (its pin instruction, which read the pin off the installed plugin's version)
Superseded-by: ADR-0073 — puts the resolve step under a 20-second in-shell bound
Reconciled: applied — Mode 2 and the Tool policy impeccable row read the npm-channel pin.
Source: docs/blueprint.md amendment of 2026-07-25 (c-mechanisms), decision (a), deciding commit 7d52356

## Decision

`npx impeccable --version` returns the numeral, and the detector runs as `npx impeccable@<numeral> detect` — never off the installed plugin's version, whose release line shares no numbering with the CLI's. BOTH numerals are recorded, the CLI's and the plugin's (`claude plugin list`), because the arm that JUDGES design — the `audit` skill and its `reference/` playbooks — ships with the plugin while the detector ships on npm, so pinning the CLI alone leaves the judging half unpinned. Resolution happens where the network is reachable and the mode is not read-only: `/plan` at its first front-touching slice (§6, never during planning), `/quick` when the front work starts (§4 step 2), `/debug` at the §3 diagnosis freeze. A pin that cannot be resolved at all — no Node, offline, registry error — is named in the mode's own record instead of left standing. The recipe is the single source for all of it, in `plugin/skills/_shared/front-surface.md`.

## Context

The old instruction resolved the pin off the plugin's version and left a placeholder that was never a runnable command, so the detect gate failed INTO the `Verify-exception` it exists to close.
