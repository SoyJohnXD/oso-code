# oso-code

Team harness for Claude Code. A guided orchestrator that keeps the human in charge of decisions, enforces quality gates, and never lets a change ship with debt.

## What it is

- **`/plan`** — deep mode for substantial changes: intent → surface mapping → decision rounds → slices, then a sequential apply/verify loop per slice with a zero-warnings bar.
- **`/quick`** — fast mode for small, visually verifiable changes: micro-intent, rapid inline iteration, then a quality pass.
- **`/debug`** — recovery mode when something broke: reproduce-first triage (reproduce → localize → reduce), then a delegated fix plus a regression test through the same apply/verify loop.
- **Debt-sweep** — closing phase of `/plan`, and offered on a `/debug` fix that sprawled across many files: judges code debt (dead code, duplication, stray comments, rubric violations — powered by fallow) and, on `/plan` changes, ledger conformance against the frozen decisions, then applies readability-only fixes. Never functional changes.
- **Design bar** — any change that touches front surface (UI files, component directories, or a visibly rendered outcome) runs against the project's `DESIGN.md`/`PRODUCT.md` with the [Impeccable](https://github.com/pbakaus/impeccable) plugin: a pinned `impeccable detect` in the verify bar — the pin resolved from the npm CLI, whose release line is independent of the plugin's — and an audit → fix → re-audit loop at close on `/plan` and `/quick`.
- **Security pass** — offered before any commit on a change touching auth, payments, or data models: on acceptance a forked reviewer runs the native `security-review` inside its own context over the pending diff, and the findings you accept loop through fix → re-review until clean or you accept the residual.

## Repository layout

| Path | Purpose |
|---|---|
| `plugin/` | The Claude Code plugin the team installs: skills (slash commands), hooks, and the `oso-state` helper. |
| `bootstrap/` | Cross-OS installer (Linux/macOS/Windows): prerequisites, MCP wiring, legacy cleanup. |
| `docs/` | Design documents. Start with [docs/blueprint.md](docs/blueprint.md). |
| `tests/` | Hook regression suite (`tests/hooks-test.sh`) and the plugin linter (`tests/plugin-lint.sh` — every forked skill declares `background`, every forked skill declares an `end with exactly one of:` verdict block, every `oso-code:<name>` reference resolves to a real skill or agent, every call site of a skill that declares such a block carries at least one of its verdict tokens, `security-pass` never acquires its diff from a remote-qualified ref, and the Impeccable detect gate never carries a placeholder where its pin belongs — six rules `claude plugin validate` has no opinion on, though it does read the manifest, `hooks.json`, skill frontmatter and the agents). Run both plus `claude plugin validate --strict plugin` before any release. |

## Install (team)

Prerequisites per OS — the bootstrap checks and guides you, but know what you need:

| OS | Required | Notes |
|---|---|---|
| Linux | git, [Claude Code](https://code.claude.com), Node.js | jq auto-installs via your package manager |
| macOS | git, Claude Code, Node.js | jq auto-installs via Homebrew |
| Windows | nothing pre-installed — just double-click `bootstrap\install.bat` | it provisions Git for Windows, Node.js, jq, and Claude Code via winget, then runs the installer under Git Bash |

Optional on every OS: Rust (`cargo`) for the fallow analyzer — without it the debt-sweep runs rubric-only on TS/JS projects.

```bash
git clone https://github.com/SoyJohnXD/oso-code
cd oso-code
bash bootstrap/install.sh     # prerequisites, MCPs, plugins, legacy cleanup (asks before anything destructive)
bash bootstrap/verify.sh      # measurable post-install E2E — expect all checks ok
```

The installer also installs the Impeccable plugin (the design bar) by default — pass `--no-impeccable` (`-NoImpeccable` on `install.ps1`) to skip it, and `verify.sh` then reports the plugin check red. Its second impeccable check stays green either way: `npx` fetches the CLI from the public registry rather than from the plugin install. That check runs the unpinned name, so it answers whether `npx` can fetch and run impeccable at all — not whether the version the `detect` gate pins resolves.

**Windows**: no terminal needed — clone the repo, then double-click `bootstrap\install.bat`. It provisions Git for Windows, Node.js, jq, and Claude Code (via winget and Claude Code's official installer), then delegates to the same `install.sh` under Git Bash. Prefer a terminal? Run `powershell -ExecutionPolicy Bypass -File bootstrap\install.ps1`. Fallback, if you already have Git Bash and the prerequisites: run `bash bootstrap/install.sh` directly inside Git Bash.

Then restart Claude Code. Daily use:

- `/oso-code:plan <what you want to build>` — substantial changes.
- `/oso-code:quick <small change>` — fast iteration.
- `/oso-code:debug <what broke>` — diagnose and fix a bug.
- `/output-style Oso` — the team persona (optional).

Update later with `claude plugin update oso-code@oso-code` — new versions ship only on version bumps.

**Surfaces**: oso-code works on the local runtimes — terminal CLI, desktop app, and IDE extensions (they all load `~/.claude` plugins and run the hooks). Web sessions at claude.ai/code use repo-only config and never load local plugins, hooks, engram, or fallow — no harness there.

## Runtime gates

The hooks DENY tool calls — that is the enforcement, not a warning:

- A `git commit` is denied while the session's verify is not green. Two layers read the same flag: the git `pre-commit` hook the installer wires through `core.hooksPath` is the primary one — it sits at the commit's own boundary, so aliases, wrappers, and an absolute `/usr/bin/git` all reach it — and the `PreToolUse` Bash matcher covers what a git hook never sees. `core.hooksPath` is a per-repo setting: the installer wires the repo you install from and prints the one-line `git config` for any other repo, and the matcher applies everywhere regardless. `git commit --no-verify` skips the git layer by git's own design; the matcher is what catches that shape.
- An `Edit`, `Write`, `MultiEdit`, or `NotebookEdit` — and `mcp__fallow__fix_apply`, gated the same way — is denied in plan mode while no slice is active. `/quick` and `/debug` edits are never gated this way.
- Nothing is gated until a mode arms the session: with no state file the hooks allow silently and log nothing, which is every session that never ran `/plan`, `/quick`, or `/debug`.

State is per-session, in `~/.local/state/oso-code/<sanitized-session>.state`, and a restart starts unarmed: the flags are keyed by session id and SessionEnd deletes the file (a leftover from a crashed session is reported at the next start and ages out on its own). Resuming a `/plan` change means re-running `/oso-code:plan <change>`, which re-arms it. Within a session, `oso-state --session <id> clear` disarms a flow you walk away from mid-change, so a stale green does not ride over later unrelated work.

These are a discipline rail, not a lock: they consult a flag the agent itself writes through an ungated command, so they stop the accidental slip (the forgotten verify, the edit between slices) and never a deliberate bypass. Opt out of the git layer with `bash bootstrap/install.sh --no-git-hook`; the installer also declines to wire it when another tool already owns the repo's hooks, and says so in its wiring summary.

**Model expectation**: `/plan` and `/debug` are multi-turn flows and want Opus for the whole flow, so set the session model yourself (`/model`) before starting one. Nothing enforces it: a skill's `model:` frontmatter only overrides for the remainder of the turn that invoked it, so a pin there would have covered phase 0 and nothing else. The forked judges (`debt-sweep`, `doubt-pass`, `security-pass`) do pin `opus`, because one invocation there is one agent run.

## Design principles

1. The orchestrator guides; the human decides. Options with tradeoffs, never silent assumptions.
2. Hooks validate state, not content. Planning runs in native Plan Mode.
3. Context is a budget: global instructions stay under 2k tokens; behavior loads on demand via skills.
4. Engram stores decisions and summaries — not phase noise.
