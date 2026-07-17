# oso-code — Blueprint

Frozen design for the oso-code harness. Amendments require a new decision, not a silent edit.

## Amendments

- 2026-07-02, execution model (user decision): `/plan` execution is delegated, gentle-style — an `oso-applier` subagent per slice (fed the frozen ledger; blocked-and-return instead of assuming; orchestrator resolves questions with the human and relaunches fresh) and an `oso-verifier` subagent per slice (no edit tools; independent rerun of every check; verdict with evidence gates `verify_green`). The orchestrator never writes code during execution. `/quick` remains inline.

- 2026-07-02, after adversarial review: hooks are pure bash (no runtime jq dependency) and log every gate event to `~/.local/state/oso-code/events.jsonl`; the commit matcher is tokenized (flag-tolerant, quote-safe); `oso-state` writes are lock-protected and atomic; `/plan` re-arms runtime state on resume; on PR creation the frozen ledger and slice summary are copied into the PR body (engram remains the store of record); the rubric regains a hard-blockers floor (secrets, swallowed errors, callerless abstractions). Platform facts verified against docs and this machine: the model can enter Plan Mode itself (`EnterPlanMode` tool, not available to subagents), and the session env var is `CLAUDE_CODE_SESSION_ID`.

- 2026-07-11, harness audit (5-judge review): four frozen-section corrections. (a) Runtime state — the *Hooks* section's `session.json` claim is stale: state lives in per-session flat files `~/.local/state/oso-code/<sanitized-session>.state` (key=value lines, one file per session), not a single JSON blob. (b) context7 policy — the *Tool policy* table's "Never: By default" fence is replaced by concrete trigger points: context7 is now wired into executable prompts — the `oso-applier` (frontmatter tools plus a never-guess-a-signature contract) and the `/plan` decision rounds / `/quick` iterate steps (library-dependent decisions verified against current docs before recommending). (c) Rubric thresholds — the rubric now carries soft-trigger thresholds (parameter count, function length, nesting → written justification, never mechanical gates), one countable hard blocker (an abstraction with fewer than two real callers unless a frozen ledger decision names it), file-level single-responsibility, and a stack-translation clause (idioms named in TS/JS, applied in the host language's equivalent). (d) Pre-freeze gates — decision rounds now close through a battery→ledger reconciliation checklist, an assumption register, and YAGNI citations before the human freezes the ledger.

- 2026-07-11, adaptive behavior: operator adaptation across four frozen sections; this amendment authorizes syncing the named bodies to it. (a) Operator preference store — a single engram observation under topic key `oso/preferences` (one upserted observation, `type: preference`, `scope: personal` — honest per-machine, `$HOME` not per-person) holding three preferences: E2E walkthrough (always / never / offer each time), explanation depth (concise / standard / didactic), and adaptive teaching (auto-detect / always / off). Asked once as one round in `/plan` step 0 on first run (no observation yet), read silently at every plan/quick start thereafter, never re-asked; `/quick` consumes it but never asks; natural-language changes update it through `mem_update` (merge, never overwrite). (b) Optional end-to-end walkthrough — a new `/plan` phase 5: the end-to-end narrative, the slice map, and the risks plus the frozen ledger decisions that shape the design, gated on the walkthrough preference (deliver / offer / skip). It explains and never reopens — a decision the operator wants to revisit goes back through the ledger like any blocked question. (c) Gap-evidence adaptive teaching — when a request shows a knowledge gap (contradicts current standard practice, or the operator can't say what the ask involves) the flow briefly explains the terrain and recommends the standard path with the why before executing; the depth lands in `/plan` Intent and `/quick` Micro-intent, the trigger in the global rules, guarded to never fire when the operator demonstrates knowledge (teaching, not gatekeeping). (d) Oso register — Colombian Spanish addresses the operator with tuteo (tú), switching to usted only where it is the natural idiom (e.g. "hágale pues"); voseo is banned (no vos, sabés, tenés, querés, podés).

- 2026-07-12, walkthrough-before-approval + pana voice + language policy + index recall: nine frozen corrections. (D1/D2) The walkthrough is its own phase before approval, not between approval and execution — the slice plan is presented, the walkthrough explains it, then a single operator approval is the one gate that starts execution (the former separate "operator says ready" gate is gone); on that approval the plan saves, the `oso/index` row upserts to `executing`, and runtime state initializes. (D3) Oso's register is a pana corrector — a warm Colombian paisa seed (parcero, de una, qué pena, pues interspersed) over a technically exacting stance, with the voseo ban and the anti-caricature guard intact. (D4) Persona scope excludes delegations: subagent prompts, Agent/Task instructions, and engram technical content are always English and persona-free — stated in the persona scope and the global rules. (D5) Engram observations carry English content and English titles; Oso narrates them in Spanish on request. (D7) `/plan` step 0 self-heals stale `executing` index rows against plan/summary evidence (`mem_update` merge, executing-only guard). (D8) The `oso/index` format is standardized once: rich title `oso/index — {project}: {n} changes, active: {change}`, a `NEXT:` line, the status vocabulary `planning / executing / done / roadmap`, literal topic keys as detail (dash wiki-links banned), roadmap parents listing their child changes, and explicit non-code pendings. (D6/D9) Released as 0.9.0 (reinstall required); the ecommerce project's stale `oso/index` row is corrected at Close (memory-only).

- 2026-07-16, windows-install-behavior: durable install, cross-skill reachability, identity-level voice, and a comprehension-gated walkthrough. (D3) MCP wiring goes hybrid and durable — context7 rides the oso-code plugin's own `.mcp.json` (auto-registers on install, the engram mechanism; its tool names become `mcp__plugin_oso-code_context7__*`), fallow is provisioned by the installer (cargo/prebuilt plus `claude mcp add`), and the redundant user-scope context7 is migrated away; the installer never aborts on an MCP failure — it accumulates failures and prints an end-of-run per-server summary (OK/FAILED + reason + manual fix), and `verify.sh` asserts engram, context7, and fallow present AND Connected. (D2) `oso-state` is reachable from every skill — a SessionStart hook (`persist-state-bin.sh`) exports `OSO_STATE_BIN=<plugin>/bin/oso-state` to `CLAUDE_ENV_FILE` (no-op safe), all skill invocations use `"${OSO_STATE_BIN:-oso-state}"`, and `verify.sh` resolves the ACTIVE installed plugin version (installed_plugins.json installPath via jq, `sort -V` fallback) and round-trips `oso-state` through the exact skill form. (D1/D10/D4) The Windows bootstrapper duplicates no logic — `install.bat` (double-click) calls `install.ps1` (PS 5.1-safe; winget-provisions Git.Git, jqlang.jq, and OpenJS.NodeJS.LTS per-user; installs Claude Code via the official `irm https://claude.ai/install.ps1` in a child powershell when missing; re-reads the registry PATH for winget lag; honest exit codes), which delegates to the same `install.sh` under Git Bash; `-CiMode` is the documented CI boundary and `ci.yml` gains a `test-windows` job. (D5) Voice is identity-level — Oso is parcero in every language (Spanish full slang; other languages warmth with occasional markers), anchored by three sample lines under a "short never flattens tone or identity" precedence, and the installer's `ensure_output_style` sets `Oso` when absent or missing, migrates the old Gentleman style, and respects any other explicit choice. (D6-D8) The `/plan` §5 walkthrough is a contract — a standalone didactic MESSAGE before approval, then an `AskUserQuestion` comprehension check with a review loop that never reopens decisions, and only then `ExitPlanMode`; walkthrough content in the `ExitPlanMode` argument is hard-banned. A teaching-moment block (three triggers × worked examples, precedence over short answers, per-topic guard) lands in plan/quick/global, and the didactic definition lives once in `plugin/skills/_shared/didactic.md`, referenced by path. Released as 0.10.0 (reinstall required); the operator's teaching=always preference (D9) is engram data, not a repo default, and the Claude Code benchmark evaluation adopted nothing (D11, operator decision).

- 2026-07-06, plan flow: `/plan` gains a Surface mapping phase between Intent and Decision rounds — up to 3 parallel `Explore` subagents build an evidence-based map of what the change touches from the approved intent, and generate the question battery from that map; the Decision-rounds category table is demoted from question generator to blind-spot audit floor, and falls back to generating questions only when exploration surfaces nothing. Every question in the battery must cite the code evidence that motivates it and the consequence of leaving it undecided. Engram recall gains a convention: a single `oso/index` observation (one upserted row per change: description + `status: executing` at Slicing, `status: done` at Close) so resuming a change means searching the index first instead of guessing topic keys, with a direct topic-key search as fallback when the index doesn't exist yet. Every `mem_save` on a ledger, plan, or summary now carries a rich title (`{topic key} — {human description}`). `/quick` summaries follow the same rich-title rule but are never added to the index — quick changes don't need cross-session discovery.

## Foundational decisions

| Decision | Choice | Rationale |
|---|---|---|
| Platform | Claude Code first; OpenCode later as adapter | Focus now; keep orchestrator specs platform-agnostic where cheap |
| Distribution | One versioned Claude Code plugin + small bootstrap | `/plugin` install/update for the team; less bug surface than file sync |
| Plan state | Engram only — no files inside project repos | User preference: clean projects; accepts per-machine tradeoff |
| Enforcement | Plan Mode (hard) + state-flag hooks + prompt guidance | Hooks validate state booleans, never content — avoids agent thrashing |
| Repos | This monorepo; legacy repos harvested then archived | Atomic versioning of rubric + gate + skill |
| Context budget | Global CLAUDE.md ≤ 2k tokens | Current setup burns 40k+; behavior moves to on-demand skills |
| Reference | gentle-ai kept as prompting reference only | The system works; oso-code is tailored, not a fork |

## Mode 1 — `/plan` (substantial changes)

Planning runs entirely in native Plan Mode (read-only, harness-enforced), entered after a resume check.

0. **Resume check** — search engram for `oso/index` (direct topic-key search as fallback when the index doesn't exist yet) to find prior work on this change; resume from the recorded phase instead of re-asking decisions already made. Read `oso/preferences` here too: on first run (no observation yet) ask one round of three preference questions and save the observation; thereafter apply it silently and never re-ask.
1. **Intent** — understand WHAT the user wants at a high abstraction level. No code, no how. Output: intent statement + in-scope/out-of-scope. Human approves.
2. **Surface mapping** — evidence first: up to 3 parallel `Explore` subagents build a map of what the change touches from the intent, and the question battery is generated from that map. The Decision-rounds category table below audits the map for blind spots — a floor, not a generator — and is the fallback question source only when exploration surfaces nothing.
3. **Decision rounds** — as many rounds as complexity demands. Each round: 3–5 questions with options and tradeoffs, sourced from the surface-mapping battery. Everything lands in a **decision ledger**: contracts, architecture, data model, error handling. Exit: category checklist covered + human declares the ledger frozen. The agent never assumes — an uncovered decision during execution stops the work and returns to the human.
4. **Slicing** — vertical slices, each with a goal, estimated files, and its own verify criteria. Order by dependency and present them; approval comes after the walkthrough (phase 5), not here.

5. **Walkthrough** — optional end-to-end walkthrough between slice presentation and approval, gated on the operator's walkthrough preference (deliver / offer / skip): the end-to-end narrative of the built thing, the slice map, and the risks plus frozen ledger decisions that shape the design. It explains and never reopens — a decision the operator wants to revisit goes back through the ledger like any blocked question. Then the operator approves — that single approval is the one gate that starts execution; on it, exit Plan Mode, save the plan under a rich title (`oso/{change}/plan — {description}`), upsert the change's `oso/index` row to `status: executing`, and initialize runtime state.
6. **Execution** — one slice at a time, delegated: an `oso-applier` subagent applies the slice, an `oso-verifier` subagent independently reruns every check (zero warnings: lint, types, tests, build as the project defines). Loop apply → verify until green, then advance to the next slice.
7. **Close** — when the user says they are happy: debt-sweep runs as a judge → fix loop inside Close (the `oso-code:debt-sweep` skill judges with fallow plus the clean-code rubric — dead code, stray comments, duplication, poor naming; the applier fixes findings, readability and semantics only, never functionality; re-judge until clean). Then commit/push/PR only if the user asks. Update the `oso/index` row to `status: done`; session summary to engram under a rich title.

## Mode 2 — `/quick` (fast iteration)

- **Micro-intent**: one exchange — what and what visible success looks like. If the orchestrator detects the change is substantial, it recommends `/plan` with the reason; the human decides.
- Rapid inline iteration with visible results (run the app, screenshot).
- On "done": quality pass — rubric verify + alignment apply + zero warnings.

## Hooks (state, not content)

- Block `git commit` while the slice/session verify is not green.
- Block Edit/Write in mode 1 when no slice is active.
- Runtime flags live in per-session flat files `~/.local/state/oso-code/<sanitized-session>.state` (key=value lines, one file per session; ephemeral, outside projects, deleted on close). Hooks read booleans from them; they never inspect model output.

## Tool policy

| Tool / convention | When | Never |
|---|---|---|
| fallow | Debt-sweep only, loaded by the debt-sweep subagent | Planning, slice verify, main context |
| context7 | Wired into executable prompts: the `oso-applier` (never-guess-a-signature contract) and the `/plan` decision rounds / `/quick` iterate steps verify library-dependent decisions against current docs before recommending | Restating docs the code already makes obvious |
| engram | Frozen decision ledger (one save), plan state (one upserted topic key), `oso/index` recall row (one upserted key per change, `status: executing` → `status: done`), session summary and discovered conventions/gotchas — all under rich titles (`{topic key} — {human description}`) | Explorations, intermediate phase artifacts, verbose progress |
| oso/preferences | First-run ask in `/plan` step 0, then read at every plan/quick start; natural-language changes update it via `mem_update` | Per-project scope (it is per-machine, `scope: personal`), asked in `/quick`, or re-asked once the observation exists |

## Bootstrap responsibilities

1. Prerequisites (runtime) per OS: Linux, macOS, Windows.
2. MCP install and wiring verification: engram, context7 (fallow configured for debt-sweep use).
3. Legacy cleanup: remove gentle-ai configs, hooks, skills, and CLAUDE.md blocks. Known duplication to kill: engram protocol (currently in three places). The persona is already consolidated in `plugin/output-styles/oso.md` — one place, no duplication to kill.

## Skill authoring rule

Every plugin skill follows the latest Anthropic skill-authoring documentation, fetched at build time. Before writing each skill, review how gentle-ai solved the equivalent prompt and harvest what works.

## Construction order

1. Monorepo skeleton, plugin manifest, slash-command skills (the `commands/` directory is legacy; `skills/<name>/SKILL.md` is the current format).
2. `/quick` mode first — simpler, fast visible value for the team.
3. `/plan` planning phases.
4. Hooks + runtime state.
5. Debt-sweep + adjusted rubrics.
6. Bootstrap with gentle cleanup.
7. Team pilot.
