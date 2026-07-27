# 0074 — `Update-EnvPath` unions, registry scopes first

Date: 2026-07-25
Status: accepted
Supersedes: ADR-0021 (its registry-PATH re-read, which replaced the process PATH)
Reconciled: elsewhere — landed in bootstrap/install.ps1; the frozen body never carried the install path.
Source: this change (harness-hardening pass); recorded with the change that made it

## Decision

The PATH refresh is a UNION of the Machine and User registry scopes with the entries that live only in this process, deduplicated, with the registry scopes FIRST.

## Context

An entry that lives only in the process — an nvm/fnm/volta shim, a caller's prepend, a CI-injected path, a portable Git — is in no registry scope, and replacing the PATH dropped it, taking `Find-GitBash`'s own `git` with it. Ordering is the behavior: appending the registry scopes behind a stale process PATH would re-shadow the very tool the refresh exists to expose.
