# oso-code on Windows

The one-step path is real — clone the repo and double-click `bootstrap\install.bat` — but it is one step over a machine that has to end up carrying several tools, and over a shell that stays part of the runtime long after the install is over. This file is what that step actually needs, what it provisions for you, how to prove the result, and what each way it can go wrong looks like when it does.

Everything here is Claude Code. The Codex host has its own prerequisites and its own installer, documented in [the README](../README.md#codex); nothing below applies to it.

## What a clean Windows 10 or 11 machine needs

| Requirement | Who provides it | Why it is on this list |
|---|---|---|
| PowerShell 5.1 | Windows | `install.ps1` targets it; every supported Windows ships it, so nothing installs it |
| winget (App Installer) | you, from [aka.ms/getwinget](https://aka.ms/getwinget) | the provisioning path is winget; without it the three rows below it are not installed for you |
| Git for Windows | the bootstrap, via winget `Git.Git` | `git`, and **Git Bash**, which is a permanent runtime dependency — see below |
| **Node.js 22 or newer** | the bootstrap, via winget `OpenJS.NodeJS.LTS` | a floor, not a presence check: the fallow npm package declares `engines: node >=22`, and context7 starts through `npx` from the same install |
| jq | the bootstrap, via winget `jqlang.jq` | the installer reads and rewrites `settings.json` with it |
| Claude Code | the bootstrap, via Anthropic's own installer | `install.sh` refuses to run without a `claude` on PATH |

**Git Bash is not an install vehicle you can uninstall afterward.** All five hooks this plugin registers are `.sh` files, and a native Windows Claude Code spawns each of them through Git Bash — so a machine that loses Git Bash loses every runtime gate at once, silently. That is why `install.ps1` waives every other probe under `-SkipPrerequisiteCheck` and never waives this one: with nothing to delegate *to*, continuing only moves the same abort somewhere less legible.

Provisioning is best effort; the requirements are not. Provisioning runs first and the preflight reads the machine after it: whatever winget could not install, it names — all of the gaps at once, each with the command that closes it — and stops there, before the run hands off to `install.sh`. It fails closed on purpose: a gap carried past that line reaches the same refusal from a bash script instead, with the actionable half of the message already scrolled off a double-clicked console.

## Installing

Clone once, from a terminal or from GitHub Desktop:

```bash
git clone https://github.com/SoyJohnXD/oso-code
cd oso-code
```

Then either double-click `bootstrap\install.bat` — it hands off to `install.ps1` with an execution policy that lets an unsigned local script run, and pauses at the end so a double-clicked window does not vanish over its own report — or, from a terminal you already have open:

```powershell
powershell -ExecutionPolicy Bypass -File bootstrap\install.ps1
```

Both routes end in the same place: `install.ps1` provisions what is missing, asserts the requirements, then runs the same `bootstrap/install.sh` every other platform runs, under Git Bash. There is no PowerShell port of the installer to drift from it.

### Flags

`install.ps1` takes six switches. The first four are forwarded to `install.sh` verbatim; the last two govern PowerShell's own half of the run.

| Flag | Effect |
|---|---|
| `-Yes` | forwards `--yes`: skips `install.sh`'s confirmation prompt |
| `-ReplaceClaudeMd` | forwards `--replace-claude-md`: replaces `~/.claude/CLAUDE.md` instead of merging into it |
| `-NoImpeccable` | forwards `--no-impeccable`: skips the Impeccable design-bar plugin |
| `-NoGitHook` | forwards `--no-git-hook`: skips wiring this repo's `core.hooksPath` commit gate |
| `-SkipPrerequisiteCheck` | installs past probes that cannot see a tool that really is there (an unusual PATH, a portable install). `install.sh` re-checks `git`, `jq` and `claude` itself, so a gap that is real still stops the run — later, after the provisioning time this one already spent. Git Bash is never waived |
| `-CiMode` | provisioning plus a delegation smoke test, then stop. It never installs Claude Code and never runs the real `install.sh`; it exists so CI can exercise every PowerShell path without an authenticated client |

### What "per-user, with consented elevation" means in practice

The whole promise of a one-step Windows path is that it needs no administrator, and a machine-wide winget install is exactly where that stops being true. So every package is asked for at user scope first. A machine-wide retry happens only when three things hold at once:

1. winget answered `APPINSTALLER_CLI_ERROR_NO_APPLICABLE_INSTALLER` — the one exit code that means *this package ships no per-user installer*. A download failure, a refused source agreement or a full disk each come back as some other code, and retrying those without `--scope` would turn a network blip into a UAC prompt nobody asked for.
2. You said yes to a question that names the package and says Windows will show a UAC prompt.
3. The run is not under `-Yes`. `-Yes` answers `install.sh`'s own confirmation and is no consent to elevate; an unattended run has nobody at the keyboard for the UAC dialog either, so it declines and hands you the `winget install` command to run yourself.

Nothing here ever elevates silently, and nothing elevates at all under `-Yes`.

Under Git Bash the same policy holds with one deliberate asymmetry: an 8-bit `$?` cannot carry winget's HRESULT, so `install.sh` cannot tell *no applicable installer* from any other failure and asks on **any** per-user failure. It is wrong only in the direction of not elevating.

## Fallow

Fallow is the analyzer the debt-sweep phase runs on. `bash bootstrap/install.sh` provisions and wires it for you on every host; these are the same two steps by hand:

```bash
npm install --global fallow@3.14.0
claude mcp add --scope user fallow -- fallow-mcp
```

Three things about that pair are worth stating, because each has cost a real install:

- **The package is `fallow`.** `fallow-mcp` is the name of a bin it ships; as a package name it is a 404.
- **The version is pinned.** `3.14.0` is the release this repo has verified, the way it pins the Codex CLI, Impeccable and engram. Never `@latest`.
- **On Windows the second command must not use the bare name.** `npm install --global fallow` drops three shims into npm's global prefix: `fallow-mcp.cmd`, a `.ps1`, and an extensionless shell script for Git Bash. That last one is what `command -v` finds first, and the Claude Code client is a native Windows process that cannot spawn it. Point the entry at the `.cmd` instead:

  ```bash
  claude mcp add --scope user fallow -- "$(npm prefix -g)/fallow-mcp.cmd"
  ```

  `%APPDATA%\npm` is only npm's *default* prefix, which is why that command asks npm rather than assuming: an operator who ever set `prefix` has the `.cmd` somewhere else entirely, and the installer resolves it the same way.

No Rust toolchain is required anywhere: the npm package ships prebuilt binaries for win32-x64, win32-arm64, both macOS arches and linux gnu and musl. Building the server yourself with `cargo install fallow-mcp` still works as an alternative; nothing here needs it.

## Claude Desktop

Claude Desktop's **Code tab runs the same engine as the CLI** and shares its configuration out of `~/.claude` — `CLAUDE.md`, MCP servers, hooks, skills and `settings.json`. So the harness reaches Desktop with nothing extra installed: the tree the installer writes is the tree Desktop opens, and the `settings.json` `env` block is how a client started from Explorer is handed what a client started from a shell gets out of its shell.

Two things are worth knowing anyway:

- **Git must be installed** for Desktop's local sessions on Windows. The Git for Windows this bootstrap provisions satisfies that, so a machine installed the way this page describes already has it.
- **The chat tab is a different surface.** `%APPDATA%\Claude\claude_desktop_config.json` carries MCP servers for the chat tab only. It reaches no files, and nothing in this harness reads or writes it. Wiring a server there does not wire it for the Code tab, and vice versa.

Desktop is an application, not something this bootstrap can provision. `verify.sh` reports whether the machine carries it, and says what that does not prove, on a `note:` either way — a CLI-only operator must not go red for software they never wanted, and nothing about an application no installer here touches can fail a run, so the tally never counts it.

## Verifying the install

Double-click `bootstrap\verify.bat`, or run `bash bootstrap/verify.sh` from Git Bash. They print the same report; `verify.bat` finds Git Bash through the same three candidates in the same order `install.ps1` does, pins `HOME` the same way, and pauses at the end when Explorer launched it.

The report is one line per check, then a `----` rule, then a closing `passed: N, failed: M`. Three line kinds appear in it:

```
ok:   oso-code plugin installed (1)
FAIL: fallow MCP connected — expected 1, got 0 — fix: …
note: Claude Desktop — …
```

- `ok:` and `FAIL:` are checks; they are what move `passed:` and `failed:`. **The run is green when `failed: 0`** — not when a particular number of checks passed — and that is what the exit status reports: zero on green, nonzero otherwise.
- A `FAIL:` carries its remediation on the same line, after `fix:`. That is the command to run; the sections below explain the ones that need explaining.
- A `note:` is **not a check and moves neither number.** Notes are where your own choices and the optional pieces get reported: an `--no-impeccable` opt-out, no jq to read the install record with, a repo whose `core.hooksPath` belongs to another tool, Claude Desktop whether it is there or not. A green run is every `ok:` plus whatever notes describe your machine.

## Troubleshooting, by symptom

### `winget not found`

The provisioning path is winget, so without it the bootstrap installs nothing and the preflight then stops on everything that was missing. Install App Installer from [aka.ms/getwinget](https://aka.ms/getwinget) and re-run — or install Git for Windows, Node.js 22+ and jq yourself, in which case the preflight passes and the run continues normally.

### `<tool> installed but not on PATH yet - reopen the terminal and re-run`

winget wrote the new tool into the registry PATH, and this process is still holding the copy it started with. The bootstrap re-reads the machine and user scopes after every install precisely to avoid this, so seeing it means the write had not landed yet. Open a new terminal (or double-click `install.bat` again) and re-run; nothing needs undoing first.

### `cannot install - N prerequisite(s) missing`

This is the preflight, and it is deliberate: it names every gap at once with the command that closes each one, before the run spends any more of your time. Close what it names and re-run. If one of them *is* installed and only this check cannot see it — an unusual PATH, a portable install — re-run with `-SkipPrerequisiteCheck` and `install.sh` will make the final call itself.

### `claude` is not found right after its own installer ran

The vendor installer writes the registry PATH this script re-reads, and a delayed write or a roaming profile can still leave the current process seeing none of it. Before declaring Claude Code missing, the bootstrap checks the binary's documented home, `%USERPROFILE%\.local\bin\claude.exe`, and prepends that directory for the rest of the run. So if the preflight *still* names Claude Code, the install genuinely produced nothing there: install it from [code.claude.com](https://code.claude.com) and re-run.

### `Git Bash - install Git for Windows`, or `cannot verify: no Git Bash on this machine`

Both entry points look for `bash.exe` in the same three places, in this order: beside wherever `git.exe` was found (`<git root>\bin\bash.exe`), then `%ProgramFiles%\Git\bin\bash.exe`, then `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`. A Git installed by some other packager may put it somewhere none of those reach. The fix is the official package:

```powershell
winget install --id Git.Git --exact --scope user
```

An unverifiable install is a failure and never a silent skip, which is why `verify.bat` refuses rather than reporting nothing.

### `FAIL: home dir the Windows client reads`

Git Bash resolves `$HOME` from an inherited `$HOME` first, then `HOMEDRIVE`+`HOMEPATH`, and only then `%USERPROFILE%`. `claude.exe` is a Node process, so `os.homedir()` — `%USERPROFILE%`, always — is the only tree it ever opens. On a roaming or `HOMESHARE` corporate profile, or a machine carrying an MSYS2 `$HOME` of its own, those two are different directories, and an installer that writes `CLAUDE.md`, `settings.json` and every backup into the first one has installed nothing the client will ever read.

`install.ps1` and `verify.bat` both pin `HOME` to `%USERPROFILE%` before they delegate, so this failure means the run came in some other way. Re-run through `bootstrap\install.ps1`, or set the pin yourself before running the shell script directly:

```bash
export HOME="$USERPROFILE"
bash bootstrap/install.sh
```

### `FAIL: fallow MCP connected` on a machine where fallow is installed

Usually the entry is wired to a command the client cannot spawn — most often the bare `fallow-mcp`, which resolves to the extensionless Git Bash shim. `claude mcp get fallow` exits 0 for an entry whose command cannot be spawned, so the entry's mere existence proves nothing; the installer reads the wired command back and compares it, and names both commands when they differ.

Re-running the installer cannot fix this by itself: `claude mcp add` refuses to overwrite an entry it did not write, so the entry stays exactly where it is. Deleting user-scope MCP state is your call, which is why you are handed the two commands instead:

```bash
claude mcp remove fallow -s user
claude mcp add --scope user fallow -- "$(npm prefix -g)/fallow-mcp.cmd"
```

The installer's own failure line carries the resolved path for your machine; use that one where it differs. Then restart Claude Code.

### `FAIL: engram binary the client resolves and runs`

Two different machines produce this line, and the verdict says which one you have.

**`no engram.exe on the persisted machine or user PATH`** — the binary is not where the client will look. The client resolves a bare `engram` inside `claude.exe`, against the persisted machine and user PATH scopes; Git Bash's own PATH carries `/usr/bin`, `/mingw64/bin` and `$HOME/bin`, none of which a native Windows process can use, so an engram reachable only from your shell is not reachable at all. Re-run `bash bootstrap/install.sh`, which downloads the pinned release into `~/.local/bin` and names the command to add that directory when it is not on the persisted PATH. A new terminal plus a Claude Code restart is what picks it up.

**`<path> does not run`** — the bytes are there and the machine will not execute them. Upstream's prebuilt releases are unsigned, and it documents Defender and other scanners flagging them as a heuristic false positive; a quarantined copy surfaces exactly here. Delete the copy the verdict names — it is on that same line — and let the installer place the pinned release again:

```bash
rm "<the path the verdict named>"
bash bootstrap/install.sh
```

If the replacement will not run either, the quarantine is the thing to address — the installer's own summary names the manual install command for that case.

### `FAIL: Git Bash path the client spawns hooks with`

`settings.json` publishes `env.CLAUDE_CODE_GIT_BASH_PATH`, which is what Claude Code spawns every one of this plugin's hooks through wherever it cannot locate Git Bash itself. A stored path that no longer resolves — Git reinstalled, moved from Scoop to the official package, or on a drive that is not mounted — takes every gate on the machine with it and says nothing.

The installer writes that key where it is absent and repairs it where it has gone stale, never over a value that still resolves. But it can only repair it with a Git Bash it was handed, which is `install.ps1`'s job — so a run that came in through Git Bash directly, with a stale key already stored, reports the staleness rather than guessing at a replacement. Re-run through `bootstrap\install.ps1`, or set the key yourself to the `bash.exe` you have (typically `C:\Program Files\Git\bin\bash.exe`), then restart Claude Code.

### The install finished, but a skill says it cannot reach state

`settings.json` also publishes `env.OSO_STATE_BIN`, the absolute path to the installed plugin's `bin/oso-state`, because the client's injection of the plugin's bin into the Bash tool PATH is undocumented and has already failed on Windows. When it is missing, every skill falls through to a bare `oso-state` that a native Windows client resolves to nothing — and the hooks exit clean, so there is no signal anywhere. `verify.sh` round-trips the *stored* value for exactly this reason. Re-run `bash bootstrap/install.sh` to publish it, then restart Claude Code.

### Running `bash bootstrap/install.sh` directly under Git Bash

It works, and it is the same script `install.ps1` ends up running — but three things `install.ps1` does around it do not happen on that route: the preflight that names every missing prerequisite at once before provisioning, the `HOME` pin above, and the Git Bash discovery whose result gets published as `CLAUDE_CODE_GIT_BASH_PATH`. Export `HOME="$USERPROFILE"` first, expect `install.sh`'s own abort in place of the preflight, and run `bash bootstrap/verify.sh` afterward — its home-dir and Git-Bash-path checks are what tell you whether the two gaps mattered on your machine.
