# OsoCode

Team engineering harness for Claude Code and OpenCode. OsoCode keeps the operator in charge of decisions, delegates implementation and independent verification, and closes every change against explicit quality gates.

Codex support now lives in the separate `oso-code-codex` fork. This repository no longer installs, configures, verifies, or ships Codex runtime surfaces.

## Workflows

- **Plan** — `/oso-code:plan` on Claude Code or `/oso-plan` on OpenCode: intent, surface mapping, decision rounds, slicing, then an apply/verify loop with a zero-warning bar.
- **Quick** — `/oso-code:quick` or `/oso-quick`: small, bounded iteration followed by a quality pass.
- **Debug** — `/oso-code:debug` or `/oso-debug`: reproduce, localize and reduce before a delegated fix and regression evidence.
- **Roadmap** — `/oso-code:roadmap` or `/oso-roadmap`: approve a queue and its autonomy policy once, then execute its plan changes in order.
- **Debt sweep** — judges code debt and conformance to the frozen decision ledger after functionality is complete.
- **Security pass** — reviews changes involving authentication, authorization, payments, or sensitive data before they ship.

Plan execution can be sequential in the main checkout or parallel by wave in isolated worktrees. Every applier returns a structured proof block; the independent verifier runs the criteria itself before reconciling those claims.

## Repository layout

| Path | Purpose |
|---|---|
| `plugin/` | Claude Code plugin: skills, agents, hooks, git gate, state helper, MCP declaration and output style. |
| `opencode/` | OpenCode plugin, commands, agents and generated skill wrappers. |
| `core/` | TypeScript source for gates, installers, state, scans, generated prose and tests. |
| `bootstrap/` | Cross-platform installers plus the generated `oso` CLI and published artifact hashes. |
| `docs/` | Architecture, decisions, parity records and operating guides. |
| `tools/` | Repository checks and support scripts. |

Generated runtime files are committed. Edit their source under `core/src/`, then run `npm run build`.

## Install

Requirements: Git and Node.js 22 or newer.

### Claude Code

```bash
bash bootstrap/install.sh --yes
node bootstrap/oso.js verify --host claude
```

The installer provisions the plugin, MCP integrations, optional Impeccable support, the state runtime and the repository git gate. On Windows, use `bootstrap\install.bat` or:

```powershell
powershell -ExecutionPolicy Bypass -File bootstrap\install.ps1
```

Restart Claude Code after installation. Daily commands are `/oso-code:plan`, `/oso-code:quick`, `/oso-code:debug` and `/oso-code:roadmap`.

### OpenCode

The supported OpenCode version is declared in `core/src/install/pins.ts`.

```bash
node bootstrap/oso.js install --host opencode --yes
node bootstrap/oso.js verify --host opencode
```

The installer preserves unrelated `opencode.json` keys while installing OsoCode's plugin, commands, agents, skill wrappers, MCP wiring, global guidance and git gate. Daily commands are `/oso-plan`, `/oso-quick`, `/oso-debug` and `/oso-roadmap`.

## Runtime discipline

OsoCode's hooks are a discipline rail, not a security boundary:

- commits are denied while an armed change is not green;
- plan-mode edits are denied when no slice is active;
- production-shaped commands are denied while an unattended run is in flight;
- stale repository state is reported with an executable recovery route;
- state is keyed by the repository's absolute git common directory, so linked worktrees share one run;
- a terminal command from the operator remains outside the agent-marked git gate.

The state helper lives at `plugin/bin/oso-state`. It records mode, active slice, verification state, roadmap position, run journal, approval artifacts and scan results under `~/.local/state/oso-code`. No operational plan document is written into the product repository.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run check
```

`npm run build` regenerates the committed state helper, gate bundles, host prose, hook manifest and OpenCode bundle. `npm run check` proves those artifacts match their sources exactly.

The release version is declared in `plugin/.claude-plugin/plugin.json` and documented in `CHANGELOG.md`. Tags use `v<version>`.
