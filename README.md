# oso-code

Team harness for Claude Code. A guided orchestrator that keeps the human in charge of decisions, enforces quality gates, and never lets a change ship with debt.

## What it is

- **`/plan`** — deep mode for substantial changes: intent → surface mapping → decision rounds → slices, then a sequential apply/verify loop per slice with a zero-warnings bar.
- **`/quick`** — fast mode for small, visually verifiable changes: micro-intent, rapid inline iteration, then a quality pass.
- **Debt-sweep** — final phase on every change: detects dead code, duplication, stray comments, and rubric violations (powered by fallow), then applies readability-only fixes. Never functional changes.

## Repository layout

| Path | Purpose |
|---|---|
| `plugin/` | The Claude Code plugin the team installs: skills (slash commands), hooks, and the `oso-state` helper. |
| `bootstrap/` | Cross-OS installer (Linux/macOS/Windows): prerequisites, MCP wiring, legacy cleanup. |
| `docs/` | Design documents. Start with [docs/blueprint.md](docs/blueprint.md). |
| `tests/` | Hook regression suite (`tests/hooks-test.sh`). Run it plus `claude plugin validate --strict plugin` before any release. |

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
bash bootstrap/install.sh     # prerequisites, MCPs, plugin, legacy cleanup (asks before anything destructive)
bash bootstrap/verify.sh      # measurable post-install E2E — expect all checks ok
```

**Windows**: no terminal needed — clone the repo, then double-click `bootstrap\install.bat`. It provisions Git for Windows, Node.js, jq, and Claude Code (via winget and Claude Code's official installer), then delegates to the same `install.sh` under Git Bash. Prefer a terminal? Run `powershell -ExecutionPolicy Bypass -File bootstrap\install.ps1`. Fallback, if you already have Git Bash and the prerequisites: run `bash bootstrap/install.sh` directly inside Git Bash.

Then restart Claude Code. Daily use:

- `/oso-code:plan <what you want to build>` — substantial changes.
- `/oso-code:quick <small change>` — fast iteration.
- `/output-style Oso` — the team persona (optional).

Update later with `claude plugin update oso-code@oso-code` — new versions ship only on version bumps.

**Surfaces**: oso-code works on the local runtimes — terminal CLI, desktop app, and IDE extensions (they all load `~/.claude` plugins and run the hooks). Web sessions at claude.ai/code use repo-only config and never load local plugins, hooks, engram, or fallow — no harness there.

## Design principles

1. The orchestrator guides; the human decides. Options with tradeoffs, never silent assumptions.
2. Hooks validate state, not content. Planning runs in native Plan Mode.
3. Context is a budget: global instructions stay under 2k tokens; behavior loads on demand via skills.
4. Engram stores decisions and summaries — not phase noise.
