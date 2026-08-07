# 0127 — The Windows runtime is Git Bash, and the state layer is published rather than hoped for

Date: 2026-08-07
Status: accepted
Reconciled: applied — every file above carries the change this decision records; Bootstrap responsibilities item 1 names Git Bash as the runtime dependency it is.
Source: this change (windows-install-reliability), measured on a real Windows 11 machine: `core.hooksPath` written and then read back as a foreign owner on the second run; `CLAUDE.md`, `settings.json` and every backup written into a `HOMEDRIVE`+`HOMEPATH` tree the client never opens while `verify.sh` read the same tree and reported green; every skill falling through to a bare `oso-state` that resolved to nothing; ledger decisions D1, D2, D9, D10

## Decision

### Git Bash is a runtime dependency, not an install vehicle

All five hooks `plugin/hooks/hooks.json` registers are `.sh` files, and Claude Code on Windows is a native process that spawns each of them through Git Bash. A machine that loses Git Bash after installation therefore loses every gate at once, and loses it silently — the hooks simply never run. So Git Bash is stated as a permanent requirement on every operator-facing surface, and it is the one prerequisite `-SkipPrerequisiteCheck` never waives: with nothing to delegate to, continuing only moves the same abort somewhere less legible.

`env.CLAUDE_CODE_GIT_BASH_PATH` in `settings.json` is what makes that dependency reachable for a client that cannot locate Git Bash itself. `install.ps1` discovers the path — `Find-GitBash` already had to answer that question to delegate at all — and hands it to `install.sh` as an environment variable rather than writing it, and `verify.sh` reports a stored path that no longer resolves as its own check.

### `install.ps1` owns a fail-closed preflight, and ADR-0021's delegation thesis still stands

There is still no PowerShell port of the installer: `install.bat` → `install.ps1` → the same `install.sh` under Git Bash is unchanged, and the installer logic lives in exactly one place. What changes is what `install.ps1` decides before it delegates. It had treated every prerequisite as best effort — winget absent, tool missing, tool off PATH, `claude` off PATH after its own installer, all warnings, all continuing — and then delegated into `install.sh`, whose first act is a hard abort. A clean machine spent the entire provisioning phase to die inside a bash script with the actionable warning already scrolled off a double-clicked console.

`Assert-Prerequisites` runs before delegation, names every unmet requirement at once with the command that closes it, and stops. It carries a Node floor of **22** rather than a presence probe, because the fallow npm package ADR-0128 provisions declares `engines: node >=22`, and a machine on 20 would otherwise clear a presence check and fail a later phase. `-SkipPrerequisiteCheck` waives probes for an environment they cannot see (an unusual PATH, a portable install), never the Git Bash above, and `install.sh` re-checks `git`, `jq` and `claude` itself, so a waived gap that is real still stops the run.

### `HOME` is pinned to `%USERPROFILE%`

Git Bash resolves `HOME` from an inherited `HOME` first, then `HOMEDRIVE`+`HOMEPATH`, and only then `USERPROFILE`; `claude.exe` is a Node process, so `os.homedir()` — `%USERPROFILE%`, always — is the only tree it ever opens. On a roaming or `HOMESHARE` corporate profile, or a machine carrying an MSYS2 `HOME` of its own, those diverge, and the installer wrote `CLAUDE.md`, `settings.json` and every backup where the client never looks — with `verify.sh` reading that same wrong tree and staying green, the worst shape a verifier has. `install.ps1` sets `HOME` before delegating, `verify.bat` applies the same pin at its own delegation point, and `verify.sh` compares the two values for the operator running `install.sh` under Git Bash directly, which README documents as supported.

### Both published keys are written on the bash side, with jq

`OSO_STATE_BIN` and `CLAUDE_CODE_GIT_BASH_PATH` are both written into `settings.json`'s `env` block by `install.sh`, never by PowerShell. PowerShell 5.1's `ConvertTo-Json` defaults to `-Depth 2` and flattens everything deeper, and `settings.json` holds nested hook arrays — a whole-file rewrite from that side would make the least-tested half of this bootstrap silently destructive. Both writes land after the phase-2 pre-image that makes them restorable. A value the operator set is never overwritten, one that no longer resolves is repaired, and a stale one on a run handed no candidate is reported rather than guessed at.

`OSO_STATE_BIN` exists for the same class of failure as the Git Bash key: Claude Code's injection of the plugin's bin into the Bash tool PATH is undocumented and already failed on Windows, and when it fails the hook exits clean — no signal at all, every skill falling through to a bare `oso-state` that a native Windows client resolves to nothing. The absolute path is resolved from the client's own record of where it installed the plugin and read back before it is reported, and `verify.sh`'s round-trip drives the STORED value rather than one it finds itself, which is what makes it able to fail on a machine that published nothing.

### Paths are compared as normalized keys, never as bytes

MSYS rewrites a POSIX-form path argument to `C:/…` before native `git.exe` sees it, so `install.sh` wrote `core.hooksPath` in one spelling and compared it byte-for-byte against another: a second run read its own wiring as a foreign owner and refused, and `verify.sh` degraded its check to a note telling the operator the commit gate was missing while it was present. Both sides now fold through `normalized_path` before comparing.

That helper is a COMPARISON KEY and not a canonical path — `/u/jane` comes back as `U:/jane`, and a backslash inside a POSIX filename comes back as a separator. What makes it safe is that every comparison folds both sides, so a spurious fold is symmetric and cannot move a verdict. It is therefore never stored and never printed back: a check reports the raw environment values, because a fabricated drive letter is a path the operator cannot copy into the fix the same line hands them.

### Claude Desktop's Code tab inherits all of it

Desktop's Code tab runs the CLI's engine and shares `~/.claude` — `CLAUDE.md`, MCP servers, hooks, skills and `settings.json` — so the tree every check reads is the tree Desktop opens, and the `env` block above is how a client started from Explorer is handed what a client started from a shell gets out of its shell. Nothing extra is installed or wired for it. `verify.sh` observes only whether the machine carries the app, says on its own line what that does not prove, and reports its absence as a `note:` — Desktop is an application no installer here provisions, and a CLI-only operator must not go red for software they never wanted. The chat tab's `%APPDATA%\Claude\claude_desktop_config.json` carries MCP servers only, reaches no files, and stays unwired.

## Context

The carriage-return class sits underneath all of this and is the reason it went unnoticed for a release. `json_field` captured jq output through `$(...)`, which strips a trailing newline and never a trailing CR, and four gates fed that value into the state filename digest — a session wrote `verify_green=true` into one file while the commit gate read another. The same byte made the legacy cleanup match nothing while `verify.sh` confirmed it as `ok: legacy artifacts removed (0)`, and made `merge_global_claude_md`'s marker comparison miss its own managed block so every re-run appended another copy. Every layer reported success. `.gitattributes` becomes a single `* text=auto eol=lf` rule rather than another name pin, because a default cannot be reopened by the next file that lands.

## Consequences

- A Windows machine without Git Bash cannot install and cannot verify, by design, and both entry points say so in the same words rather than one refusing and the other reporting nothing.
- `install.ps1` can now fail before it provisions anything, which is a deliberate loss of "it always tries": the run that would have continued was a run that ended in the same refusal several minutes later, delivered by a script the operator was not reading.
- `verify.sh` gains checks that a machine which published nothing will fail — the point of publishing them — so CI pins the SET of check names beside the count rather than the count alone.
- The `HOME` pin is applied at three delegation points (`install.ps1`, `verify.bat`, and the operator's own `export` on the direct Git Bash route documented in README and `docs/windows.md`). A fourth entry point that delegates into a shell script must apply it too, or it reads a different tree than the client.
