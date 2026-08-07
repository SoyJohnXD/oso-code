# 0128 — fallow is provisioned from its npm package at a pin, and counted like every other MCP

Date: 2026-08-07
Status: accepted
Supersedes: ADR-0066 (the whole of it — fallow is no longer reported on a `note:`, and the Rust prerequisite its reasoning rested on is gone)
Implemented-in: bootstrap/install.sh, bootstrap/lib/codex-managed-config.sh, bootstrap/verify.sh, tests/hooks-test.sh, docs/blueprint.md, docs/windows.md, README.md
Reconciled: applied — every file above carries the change this decision records; Bootstrap responsibilities item 2 reads fallow as asserted connected beside engram and context7.
Source: this change (windows-install-reliability); the `fallow` npm package's own published platform matrix (win32-x64, win32-arm64, darwin-x64, darwin-arm64, linux-x64-gnu, linux-x64-musl) and its `engines: node >=22`; measured that `claude mcp get fallow` exits 0 for an entry whose command cannot be spawned; ledger decision D2

## Decision

fallow is provisioned by `bootstrap/install.sh` from the npm package **`fallow`**, pinned to `3.14.0`, on every supported host — Linux and macOS as well as Windows — and `bootstrap/verify.sh` counts it as a check exactly like engram and context7. A Rust toolchain is required nowhere; `cargo install fallow-mcp` stays documented as an alternative rather than a prerequisite.

Three specifics are part of the decision, because each one has a wrong answer that looks right:

- **The package is `fallow`.** `fallow-mcp` is one of the bins it ships and is a 404 as a package name.
- **The pin is a version, never `@latest`**, the way this repo pins the Codex CLI, Impeccable and the engram release.
- **On Windows the wired command is the `.cmd` shim, resolved explicitly.** `npm install --global fallow` drops three shims into npm's global prefix — the `.cmd`, a `.ps1`, and an extensionless sh script for Git Bash. The sh script is what a PATH search finds first, and the client spawning this command is a native Windows process that cannot execute it. So the resolver probes the `.cmd` ahead of the PATH search, and asks npm for its own global prefix rather than assuming `%APPDATA%\npm`, since an operator who set `prefix` has the `.cmd` somewhere else entirely.

The wiring no longer short-circuits on an entry's existence. `claude mcp get` exits 0 for an entry whose command cannot be spawned, so existence proved nothing: a machine wired by an earlier run to the bare name — exactly the shim Windows cannot spawn — reported success while the now-mandatory check stayed red, and the obvious remedy of re-running the installer could never clear it. The entry's command is read back and compared: matching wires `ok` naming it, differing FAILS naming both commands and the two-step repoint, and an unreadable one fails rather than claiming success. The installer never repoints by itself — deleting user-scope MCP state is the operator's call, so they are handed the commands.

## Context

ADR-0066 made fallow the one MCP reported on a `note:` line and never counted, and its reasoning was sound for what it knew: fallow built from a Rust toolchain that no OS row required and no entry point provisioned, so a hard check would have made the documented one-step Windows path red by construction. **That reason no longer holds.** The npm package ships prebuilt binaries for every host this harness supports, so one `npm install --global` provisions it wherever Node 22 is present — and the Windows preflight (ADR-0127) now requires Node 22 anyway, for this package. With nothing left to build, there is nothing left for a hard check to be red about.

Provisioning it on every host rather than only on Windows is what keeps the change from breaking the operators it is not about: an existing Linux or macOS install that had fallow on a `note:` would otherwise flip red the moment the check starts counting.

ADR-0019 originally decided that `verify.sh` asserts engram, context7 and fallow present AND Connected; ADR-0066 retired the fallow third of that. This decision restores it, on a mechanism ADR-0019 did not have.

## Consequences

- `verify.sh`'s counted-check total moves, and the CI pin that reads it moves with it — enumerated name by name rather than inferred from a total.
- A machine whose fallow entry was wired by an older run to the bare name now goes RED and stays red until the operator runs the two-command repoint. That is the intended outcome: the entry was never able to start on that host, and the previous behavior was to report it as fine.
- The `fallow` pin is a second npm pin beside Impeccable's, and a version bump is a deliberate edit to `SUPPORTED_FALLOW_VERSION` in `bootstrap/install.sh`, never a silent drift.
- ADR-0066 is superseded whole. Its `Status` and the blueprint index row it appears in both say so, and Bootstrap responsibilities item 2 — the sentence its own `Reconciled:` line pointed at — now reads the opposite of what it recorded.
