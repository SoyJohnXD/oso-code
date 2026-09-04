# oso-code — Blueprint

Frozen design for the oso-code harness. [docs/decisions/](decisions/) is itself frozen as history now: nothing is deleted from it, nothing new is added to it, and no check reads it any more. The live record it used to be is the roadmap's own design document at [docs/rewrite/ts-core-roadmap.md](rewrite/ts-core-roadmap.md) and the engram ledgers — a change to this design takes a decision there, never a silent edit here and never a new file under `docs/decisions/`.

## Decisions

Every decision this design has taken since the freeze is one file under [docs/decisions/](decisions/) — one per decision, numbered in the order it was written; the ids are cited from the skills, so they never move. Each file carries its date, its status, what supersedes it and what it supersedes, the source the decision came out of, and a `Reconciled:` line saying where the decision landed:

| `Reconciled:` | Means |
|---|---|
| `applied` | the frozen body below reads as the decision decided |
| `superseded` | a later decision retired it and the body deliberately reads otherwise |
| `elsewhere` | it landed in the skills, the agents, the rubric or the installer, and the body never carried it |
| `nowhere` | it changed no file — a release record, engram data, an evaluation that adopted nothing |

`Status: superseded` means a later decision replaced the whole of it. A `Superseded-by:` on an accepted decision names the one clause that was retired and leaves the rest standing.

### Index

The index — one decision per line, dated and grouped by the commit it landed in — lives in the directory itself rather than a copy kept here, since a second index is one more place this map could go stale: [docs/decisions/](decisions/) holds 157 files today, [0001](decisions/0001-delegated-slice-execution.md) through [0157](decisions/0157-a-machines-own-paths-and-a-tools-own-cache-never-reach-the-published-tree.md).

## Foundational decisions

| Decision | Choice | Rationale |
|---|---|---|
| Platform | Claude Code, Codex and OpenCode as first-class adapters over neutral behavioral bodies (ADR-0096, ADR-0151) | One harness contract; host tools, lifecycle and paths stay in their own bindings |
| Distribution | One release: a native Claude plugin plus a Codex skills plugin and installer-owned roles, hooks, bounded config leaves and MCP wiring, and an OpenCode installer owning a strict-JSON config wholesale plus the plugin, verifier and purge under the same transactional discipline (ADR-0096, ADR-0098, ADR-0099, ADR-0102, ADR-0153) | Codex's plugin schema cannot carry or pre-trust every runtime surface; the installer verifies its own leaves, composes Engram's root pointers, and repairs only exact Oso/Engram state without annexing shared host tables or foreign owners. OpenCode's config is strict JSON, so its installer owns the file wholesale and re-applies the operator's five keys from a verified backup |
| Plan state | Engram for semantic recall; Codex additionally keeps immutable approval snapshots and mutable operational plans below `~/.local/state/oso-code/plans/` (ADR-0101) — no files inside project repos | Clean projects, durable per-machine execution evidence, and bounded hot amendments without rewriting what was approved |
| Enforcement | Native Plan Mode plus host approval adapter, state gates and prompt guidance (ADR-0096, ADR-0101, ADR-0102, ADR-0103, ADR-0104) | Runtime gates read state; Codex attests native mode from the exact turn, accepts its one host-owned terminal LF without normalizing the wire digest, binds the native approval prompt through that pending digest, and launches explicit delegated profiles with fresh complete context |
| Repos | This monorepo; legacy repos harvested then archived | Atomic versioning of rubric + gate + skill |
| Context budget | Each host's always-loaded global guidance ≤ 2k tokens | Behavior moves to on-demand skills; adding a second and a third adapter does not duplicate the harness into startup context |
| Reference | gentle-ai kept as prompting reference only | The system works; oso-code is tailored, not a fork |

## Implementation shape

The harness ships from a TypeScript core rather than per-host bash: `core/src/gates/` and `core/src/hosts/` are the runtime gates, bundled into `gate.js` for the Claude and Codex hooks below; `core/src/install/` backs the single installer CLI, `bootstrap/oso.js`; `core/src/routes/` is the one per-host gate and tool table every hook manifest renders from; `core/src/prose/` holds the agent roles and each skill's Codex/OpenCode host binding, rendered by `npm run build` into `plugin/agents/`, `codex/`, `opencode/` and the two generated `plugin/skills/_shared/references/` files. Each skill's flow itself is authored once, directly in `plugin/skills/<skill>/SKILL.md`, and rendered into the Codex and OpenCode wrappers from there — there is no shared, platform-neutral body file separate from it any more. [README.md](../README.md) is the tree's own map of every directory, the install path per host, and the full runtime-gate mechanism; this file stays at the design level.

## Modes

- **`/plan`** (`plugin/skills/plan/SKILL.md`) — substantial changes. Phases run inside native Plan Mode: a resume check, intent, surface mapping, decision rounds into a frozen ledger, and slicing, where the operator settles SEQUENTIAL execution or a PARALLEL wave (one worktree per slice, a dedicated integrator, re-verified as a whole) and the NORMAL or AUTO disposition. A Repaso-headed approval document is the single gate; execution then delegates each slice to an apply → verify loop against a zero-warnings bar, and close runs debt-sweep, the Impeccable design-audit loop on a front change, and an offered security pass before the operator's own push and PR — or, under AUTO, the run's own finish.
- **`/quick`** (`plugin/skills/quick/SKILL.md`) — fast iteration for small, easily verifiable changes: a one-exchange micro-intent, rapid inline iteration with visible results, and a closing quality pass.
- **`/debug`** (`plugin/skills/debug/SKILL.md`) — reproduce-first triage for something that broke: reproduce, localize and reduce, a frozen diagnosis naming its regression test, a delegated fix through the same apply → verify loop, then quality-pass at close.
- **`/roadmap`** (`plugin/skills/roadmap/SKILL.md`) — a queue of `/plan` changes decided once: the children and their order, a declared autonomy policy, one approval over the whole queue, then a chain that runs each child to CLOSED or SET ASIDE and returns to the operator only at its own presence phase.

Judge skills — `debt-sweep`, `quality-pass`, `security-pass`, `doubt-pass`, `triage` — are invoked by the four modes above rather than by the operator directly; each has its own `plugin/skills/<skill>/SKILL.md`.

## Hooks

Mechanical state and bounded approval transport — hooks enforce discipline and never make a semantic judgment about plan content (Design principle 2 in README.md). The full mechanism — the commit gate, the edit gate, how state is keyed per repository, and every host's own wiring — is [README.md's Runtime gates section](../README.md); its TypeScript source is `core/src/gates/` and `core/src/hosts/`, compiled to the `gate.js` every host's manifest spawns.

## Tool policy

| Tool / convention | When | Never |
|---|---|---|
| fallow | Debt-sweep only, loaded by the debt-sweep subagent | Planning, slice verify, main context |
| context7 | Wired into executable prompts: the `oso-applier` (never-guess-a-signature contract) and the `/plan` decision rounds / `/quick` iterate steps verify library-dependent decisions against current docs before recommending | Restating docs the code already makes obvious |
| engram | Frozen decision ledger (one save), plan state (one upserted topic key), `oso/index` recall row (one upserted key per change, `status: executing` → `status: done`), a roadmap's own `oso/{roadmap}/ledger` topic carrying its queue, its global entries, its policy and every child's disposition, plus that roadmap's `oso/index` row at `status: roadmap` — a parent marker that never reports progress, its `NEXT:` line holding the position — session summary and discovered conventions/gotchas, all under rich titles (`{topic key} — {human description}`) | Explorations, intermediate phase artifacts, verbose progress |
| oso/preferences | ONE record per project, at engram's own default scope — the only one `mem_search`, which filters by the resolved project unconditionally, can retrieve: the first plan in a project asks its two behavior fields in `/plan` step 0, the first AUTO or roadmap arming asks its three ceiling fields (staging route, production route, PR base branch) and mirrors the production answer into `deploy-deny/<digest>.patterns` for the production-boundary gate, a legacy `scope: personal` copy found in the project migrates in place, and every read after that is silent; natural-language changes update it via `mem_update` | Claiming per-machine reach for it, asked in `/quick`, re-asked once the project's record exists, or the ceiling fields asked anywhere but an AUTO or roadmap arming |
| impeccable | Front surfaces only (shared trigger in `plugin/skills/_shared/front-surface.md`): design docs as applier conventions, the pinned design detector in the verify bar (pin resolved from the npm CLI per that file's recipe), Impeccable's `audit` at close on `/plan` and `/quick`, its findings routed through `oso-applier` in both modes and its loop ended by that file's exit bar | Non-front changes, `/debug` init/document/audit, skipping the design bar silently when the plugin is absent, and letting the loop end without naming the residual it leaves |

## Bootstrap responsibilities

1. Prerequisites (runtime) per OS: Linux, macOS, Windows — where Git Bash is a permanent RUNTIME dependency and not an install vehicle, since the git `pre-commit` hook this plugin wires is still a `#!/bin/sh` script that git itself runs through a shell, and `install.ps1` owns a fail-closed preflight over the whole set before it delegates (ADR-0127).
2. MCP install and wiring verification: engram, context7 and fallow all asserted connected, each against the artifact that actually starts it — engram's pinned binary is downloaded, checksum-verified and asked to answer rather than inferred from a plugin install, and fallow is provisioned from its pinned npm package on every supported host, which is what retired the Rust prerequisite that had kept it on a `note:` (ADR-0128, ADR-0129). The Impeccable plugin installs by default (`--no-impeccable` opts out, recorded as a marker file the installer writes and clears), and the verifier asserts the plugin — a `note:` naming the opt-out instead, wherever that marker stands — plus the `npx impeccable` CLI behind a 20-second in-shell bound, since an unreachable registry would otherwise hang the report short of its summary.
3. Legacy cleanup: remove gentle-ai configs, hooks, skills, and CLAUDE.md blocks. Known duplication to kill: engram protocol (currently in three places). The persona is already consolidated in `plugin/output-styles/oso.md` — one place, no duplication to kill.

## Skill authoring rule

Every wrapper follows its host's current skill-authoring contract; a skill's flow is authored once, in `plugin/skills/<skill>/SKILL.md`, and rendered into the other two hosts' wrappers from there (ADR-0096). Before writing each skill, review how gentle-ai solved the equivalent prompt and harvest what works.
