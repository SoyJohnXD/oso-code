# 0067 — The `--no-impeccable` opt-out is recorded, and cleared

Date: 2026-07-25
Status: accepted
Supersedes: ADR-0046 (its "only the plugin check goes red on opt-out")
Reconciled: applied — Bootstrap responsibilities item 2 reads the marker file and the `note:` that stands in for the plugin check.
Source: this change (harness-hardening pass); recorded with the change that made it

## Decision

`install.sh` records `--no-impeccable` as a marker file (`~/.local/state/oso-code/impeccable-opt-out`) and `wire_impeccable()` deletes that file whenever it does install the plugin. `verify.sh` reads the marker: where it stands, the plugin check becomes a `note:` naming the opt-out instead of running, so the verification still ends at `failed: 0`. The two scripts hold the path independently, because both run standalone via curl and cannot source a shared file.

## Context

While the check was hard, an operator who opted out on purpose had no green path and no way to tell that choice from a broken install. Clearing the marker is the other half of the contract: left behind by an earlier opt-out, it would report a genuinely failed install as the operator's choice forever — a blind spot worse than the one the marker closes.
