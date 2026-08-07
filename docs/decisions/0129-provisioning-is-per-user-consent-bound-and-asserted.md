# 0129 — Provisioning is per-user, consent-bound, and asserted rather than assumed

Date: 2026-08-07
Status: accepted
Reconciled: applied — every file above carries the change this decision records; Bootstrap responsibilities item 2 reads engram, context7 and fallow as asserted against the artifact that actually starts each one.
Source: this change (windows-install-reliability); winget's documented return codes, where `APPINSTALLER_CLI_ERROR_NO_APPLICABLE_INSTALLER` (0x8A150010, surfacing through PowerShell as -1978335216) is the only code meaning the manifest has no installer for the requested scope; measured that a clean Windows box got `engram: OK — plugin installed` from a plugin install's exit code and then a bare `FAIL` from `verify.sh`; ledger decisions D1, D3, D4

## Decision

### Per-user first, consent before anything that can raise UAC, and none at all under `--yes`

The whole promise of the one-step Windows path is that it needs no administrator, and a machine-wide winget install is exactly where that stops being true. Every package is therefore requested at `--scope user` first. A machine-wide retry runs only when all three of these hold:

1. winget answered `APPINSTALLER_CLI_ERROR_NO_APPLICABLE_INSTALLER` — the one code that means *this package ships no per-user installer*. A download failure, a refused source agreement or a full disk each return some other code, and retrying those without `--scope` turns a network blip into a UAC prompt nobody asked for. The previous code retried on ANY non-zero exit and never examined its own result, so a second failure was reported as success.
2. The operator answered yes to a prompt that names the package and says Windows will show a UAC dialog.
3. The run is not under `-Yes` / `--yes`. That flag answers `install.sh`'s own confirmation prompt and is no consent to elevate; an unattended run also has nobody at the keyboard for the UAC dialog, so it declines and hands over the `winget install` command instead of stalling on a prompt no one will read.

### The bash half is deliberately asymmetric

`install.sh`'s own winget calls had no scope at all — defaulting to the machine-wide install this policy forbids — and no guard, so a benign non-zero exit killed the run under `errexit`. Both halves share one policy now, with one difference that cannot be closed: an 8-bit `$?` cannot carry winget's HRESULT, so the bash side cannot tell *no applicable installer* from any other failure and asks for consent on ANY per-user failure. It is wrong only in the direction of NOT elevating, which is the direction a policy about administrator rights should be wrong in.

### Everything the installer can install is provisioned AND asserted; presence is never health

`engram`, `fallow` and Impeccable are each installed by this bootstrap, so each is also verified against the artifact that actually starts it, never against the exit code of a step that installed something adjacent:

- **engram.** The installer reported `engram: OK — plugin installed` from a plugin install's exit code while the binary that plugin's `.mcp.json` launches by name was never installed or even probed. It is provisioned now from the pinned release, checksum-verified against `checksums.txt` from the same tag, per-user and without elevation, on Windows and macOS as well as Linux. The probe reads the PATH Claude Code reads — the persisted machine and user scopes on Windows — not this shell's, because a probe in the wrong process is a false green.
- **fallow.** Its wired command is read back and compared rather than assumed from the entry's existence (ADR-0128).
- **Impeccable.** Its verdict comes from the client's own plugin list rather than an install exit code.

Being present is not being healthy. The checksum proves which bytes arrived; RUNNING them proves the machine will let them run, so both the placing branch and the already-resolved branch ask the binary to answer. Without that, a failed install left a dead binary standing and the next run reported it OK — a remediation loop that ends in a false green whether or not the operator fixed anything — and `verify.sh` blamed the PATH for a binary that was on it. Upstream documents scanners flagging its unsigned prebuilt releases as a heuristic false positive, so a quarantined copy is exactly the shape a presence check cannot see: it is removed and replaced, and where a cause cannot be established `verify.sh` names both possible ones rather than asserting the one it cannot know.

The same rule retired one more false green outside the installer's own artifacts: context7 was reported from `command -v npx`, and its legacy user-scope entry was deleted before anything confirmed the replacement — a failure after that delete left an operator with no context7 where they had a working one. The plugin-shipped entry must be registered and Connected before the old one goes.

## Context

These two halves are one decision because they fail together. A best-effort provisioner that elevates on any error and a summary that reports installs it never checked produce the same experience: a green run on a machine where nothing works. Splitting them into "how we install" and "how we verify" would let either half be relaxed on its own, and each one is only load-bearing while the other holds.

## Consequences

- An unattended Windows run (`-Yes`) can now finish having installed less than an interactive one would, and says so by name with the command to close each gap. Silence was the alternative, and silence is how a machine-wide install happens to somebody who did not ask for one.
- Every asserted artifact is one more thing a fixture `HOME` fails by construction, which is why CI pins the SET of `verify.sh` check names rather than a total.
- A remediation that cannot be cleared by re-running the installer must hand the operator the command that does clear it — the fallow repoint and the quarantined-engram replacement are both that shape.
