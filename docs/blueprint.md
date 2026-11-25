# oso-code — Blueprint

The design of the oso-code harness as it stands. [README.md](../README.md) is the authority for the runtime hosts, the install path per host and the runtime discipline; this file stays at the design level.

## What it is

oso-code is a Claude Code plugin and an OpenCode host integration in one monorepo. The TypeScript core under `core/src/` is bundled into the generated files that are committed to the tree, rebuilt with `npm run build` and proven against their sources by `npm run check`. Release `0.27.0` extracted Codex into the separate `oso-code-codex` fork, so this repository ships two runtime hosts: Claude Code and OpenCode.

## Plan state

Engram holds semantic recall: the frozen decision ledger, plan state and each change's `oso/index` row. Per-machine runtime state lives under `~/.local/state/oso-code`. No plan or state file is written inside a project repository.

## Enforcement

Native plan mode plus state gates. The commit gate, the edit gate and the production boundary read the recorded state and deny what the state does not allow. Hooks enforce mechanical discipline and never judge plan content. The mechanism is the Runtime discipline section of [README.md](../README.md); its source is `core/src/gates/` and `core/src/hosts/`.

## Modes

- **`/plan`** (`plugin/skills/plan/SKILL.md`) — substantial changes. Phases run inside native Plan Mode: a resume check, intent, surface mapping, decision rounds into a frozen ledger, and slicing, where the operator settles SEQUENTIAL execution or a PARALLEL wave (one worktree per slice, a dedicated integrator, re-verified as a whole) and the NORMAL or AUTO disposition. A Repaso-headed approval document is the single gate; execution then delegates each slice to an apply → verify loop against a zero-warnings bar, and close runs debt-sweep, the Impeccable design-audit loop on a front change, and an offered security pass before the operator's own push and PR — or, under AUTO, the run's own finish.
- **`/quick`** (`plugin/skills/quick/SKILL.md`) — fast iteration for small, easily verifiable changes: a one-exchange micro-intent, rapid inline iteration with visible results, and a closing quality pass.
- **`/debug`** (`plugin/skills/debug/SKILL.md`) — reproduce-first triage for something that broke: reproduce, localize and reduce, a frozen diagnosis naming its regression test, a delegated fix through the same apply → verify loop, then quality-pass at close.
- **`/roadmap`** (`plugin/skills/roadmap/SKILL.md`) — a queue of `/plan` changes decided once: the children and their order, a declared autonomy policy, one approval over the whole queue, then a chain that runs each child to CLOSED or SET ASIDE and returns to the operator only at its own presence phase.

Judge skills — `debt-sweep`, `quality-pass`, `security-pass`, `doubt-pass`, `triage` — are invoked by the four modes above rather than by the operator directly; each has its own `plugin/skills/<skill>/SKILL.md`.

## Tool policy

| Tool / convention | When | Never |
|---|---|---|
| fallow | Debt-sweep only, loaded by the debt-sweep subagent | Planning, slice verify, main context |
| context7 | The `oso-applier` (never guess a signature) and the `/plan` decision rounds and `/quick` iterate steps verify library-dependent decisions against current docs | Restating docs the code already makes obvious |
| engram | Frozen decision ledger (one save), plan state (one upserted topic key), the `oso/index` recall row per change (`status: executing` then `status: done`), a roadmap's own `oso/{roadmap}/ledger` topic and its `oso/index` row at `status: roadmap`, session summary and discovered conventions, all under rich titles (`{topic key} — {human description}`) | Explorations, intermediate phase artifacts, verbose progress |
| oso/preferences | One record per project at engram's default scope: the first plan asks its two behavior fields in `/plan` step 0, the first AUTO or roadmap arming asks its three ceiling fields (staging route, production route, PR base branch) and mirrors the production answer into `deploy-deny/<digest>.patterns` for the production-boundary gate; every read after that is silent and natural-language changes update it via `mem_update` | Claiming per-machine reach for it, asking it in `/quick`, re-asking once the record exists |
| impeccable | Front surfaces only (trigger in `plugin/skills/_shared/front-surface.md`): design docs as applier conventions, the pinned design detector in the verify bar, Impeccable's `audit` at close on `/plan` and `/quick`, with findings routed through `oso-applier` | Non-front changes, `/debug` init/document/audit, skipping the design bar silently when the plugin is absent, ending the loop without naming the residual it leaves |

## Context budget

Each host's always-loaded global guidance stays within 2k tokens; behavior lives in on-demand skills.

## Bootstrap responsibilities

1. Prerequisites per OS (Linux, macOS, Windows). On Windows Git Bash is a permanent runtime dependency, not only an install vehicle: git runs the `pre-commit` hook through a shell. `install.ps1` runs a fail-closed preflight over the whole set before it delegates.
2. MCP wiring verified for engram, context7 and fallow, each against the artifact that actually starts it. The Impeccable plugin installs by default; `--no-impeccable` opts out.
3. Legacy cleanup: remove gentle-ai configs, hooks, skills and CLAUDE.md blocks.

## Skill authoring

A skill's flow is authored once, in `plugin/skills/<skill>/SKILL.md`, and rendered into the OpenCode wrappers from there by `npm run build`.

## Changing this design

A change to this design is a decision in the change's own plan ledger (engram) and an edit to this file in the same change. History lives in git.
