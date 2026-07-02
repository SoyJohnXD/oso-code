# oso-code

Team harness for Claude Code. A guided orchestrator that keeps the human in charge of decisions, enforces quality gates, and never lets a change ship with debt.

## What it is

- **`/plan`** — deep mode for substantial changes: intent → decision rounds → slices, then a sequential apply/verify loop per slice with a zero-warnings bar.
- **`/quick`** — fast mode for small, visually verifiable changes: micro-intent, rapid inline iteration, then a quality pass.
- **Debt-sweep** — final phase on every change: detects dead code, duplication, stray comments, and rubric violations (powered by fallow), then applies readability-only fixes. Never functional changes.

## Repository layout

| Path | Purpose |
|---|---|
| `plugin/` | The Claude Code plugin the team installs: skills (slash commands), hooks, and the `oso-state` helper. |
| `bootstrap/` | Cross-OS installer (Linux/macOS/Windows): prerequisites, MCP wiring, legacy cleanup. |
| `docs/` | Design documents. Start with [docs/blueprint.md](docs/blueprint.md). |
| `tests/` | Hook regression suite (`tests/hooks-test.sh`). Run it plus `claude plugin validate --strict plugin` before any release. |

## Design principles

1. The orchestrator guides; the human decides. Options with tradeoffs, never silent assumptions.
2. Hooks validate state, not content. Planning runs in native Plan Mode.
3. Context is a budget: global instructions stay under 2k tokens; behavior loads on demand via skills.
4. Engram stores decisions and summaries — not phase noise.
