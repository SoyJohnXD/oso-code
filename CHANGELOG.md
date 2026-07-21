# Changelog

## 0.11.0

Repaso de cambios, derived decision categories, and an anti-swallow delivery contract — the harness fixes a TUI bug that was silently hiding its own explanations and redesigns the model that had been built on top of the gap:

- Repaso de cambios (change recap) replaces the didactic walkthrough: a fixed three-section brief (Qué se va a realizar / Decisiones del ledger que lo moldean / Cómo va a funcionar), ~20-line soft cap, written in the operator's language at their depth preference — never a forced didactic register — that heads the plan argument the native `ExitPlanMode` gate renders, immediately followed by the full plan detail. No confirmation loop; `ExitPlanMode` is the single approval gate.
- Decision-rounds category model redesigned: an invariant core of five categories (Contracts, Architecture, Errors, Verification, Reuse) plus categories derived per change straight from surface evidence, each citing the surface that motivates it — the core is the fallback question generator only when exploration surfaces nothing, superseding the fixed category table's audit-floor role. Question rounds cap at 4 (the `AskUserQuestion` platform ceiling), down from 3–5.
- Anti-swallow delivery contract: the Claude Code TUI drops assistant text that precedes a tool call in the same turn, so operator-facing content now always ends its turn as plain text before any later-turn tool call, and round context travels inside `AskUserQuestion` fields instead of preceding prose. Global anchors land in `plugin/output-styles/oso.md` and `bootstrap/claude-global.md`, and `plugin/skills/_shared/didactic.md` is reconciled to drop its walkthrough references.
- First-run preference round shrinks from three questions to two — explanation depth and adaptive teaching only, the old always/never/offer gating field retired — with a self-healing migration that strips the retired field from any stored `oso/preferences` observation via `mem_update` (merge, never overwrite).

## 0.10.0

Windows install path, durable MCP wiring, reachable state, identity-level voice, and a comprehension-gated walkthrough — the harness installs clean on a fresh Windows box and stays wired, warm, and understood:

- Windows bootstrapper without duplicated logic: double-click `bootstrap\install.bat` → `bootstrap\install.ps1` (PS 5.1-safe; winget-provisions Git, Node.js LTS, and jq per-user; installs Claude Code via the official installer when missing; re-reads the registry PATH for winget lag; honest exit codes) → delegates to the same `install.sh` under Git Bash. `ci.yml` gains a `test-windows` job (hooks tests + `bash -n` + `ps1 -CiMode`).
- MCP wiring made durable: context7 now rides the plugin's own `.mcp.json` (auto-registers on install, no user-scope entry to drift — tool names become `mcp__plugin_oso-code_context7__*`), fallow is provisioned by the installer, and the redundant user-scope context7 is migrated away. The installer never aborts on an MCP failure — it accumulates them and prints an end-of-run per-server summary (OK/FAILED + reason + manual fix); `verify.sh` asserts engram, context7, and fallow present and Connected.
- `oso-state` reachable from every skill: a SessionStart hook exports `OSO_STATE_BIN` to the active plugin's `bin/oso-state` (no-op safe), all skill invocations use `"${OSO_STATE_BIN:-oso-state}"`, and `verify.sh` resolves the active installed plugin version and round-trips `oso-state` through the exact skill form.
- Voice at the identity level: Oso is parcero in every language — Spanish full slang, other languages warmth with occasional markers — under a "short never flattens tone or identity" precedence. The installer sets the `Oso` output style when absent, migrates the old Gentleman style, and respects any other explicit choice.
- Walkthrough contract plus teaching: `/plan` phase 5 delivers a standalone didactic message before approval, then an `AskUserQuestion` comprehension check with a review loop that never reopens decisions, and only then `ExitPlanMode` — walkthrough content in the `ExitPlanMode` argument is banned. A teaching-moment block (three triggers with worked examples) lands in plan/quick/global, and the didactic definition lives once in `plugin/skills/_shared/didactic.md`, referenced by path.

## 0.9.0

Walkthrough-before-approval, pana voice, language policy, and index recall — the plan flow tells one story and speaks in one voice:

- Walkthrough moved ahead of approval: the slice plan is presented, the optional end-to-end walkthrough explains it, then a single operator approval is the one gate that starts execution — the former separate "operator says ready" gate is gone. On that approval the plan saves, the `oso/index` row upserts to `executing`, and runtime state initializes.
- Pana voice identity: Oso is a warm Colombian paisa corrector — an expanded seed (parcero, de una, qué pena, pues interspersed) over a technically exacting stance, with the voseo ban and the anti-caricature guard intact.
- English delegations and engram-language policy: the persona styles conversation only — subagent prompts, Agent/Task instructions, and engram technical content are always English and persona-free (stated in the persona scope and the global rules); engram observations carry English content and English titles, narrated in Spanish on request.
- Index recall hardened: `/plan` step 0 self-heals stale `executing` index rows against plan/summary evidence (`mem_update` merge, executing-only guard), and the `oso/index` format is standardized once — rich title `oso/index — {project}: {n} changes, active: {change}`, a `NEXT:` line, the status vocabulary `planning / executing / done / roadmap`, literal topic keys as detail (dash wiki-links banned), roadmap parents listing their children, and explicit non-code pendings.
- The ecommerce project's stale `oso/index` row is corrected at Close (memory-only).

## 0.8.0

Operator adaptation — the harness learns how each operator wants to work and meets them there:

- Operator preferences ask once, then apply forever: a single `oso/preferences` engram observation (per-machine `scope: personal`, one upserted row) captures three preferences — E2E walkthrough (always / never / offer each time), explanation depth (concise / standard / didactic), and adaptive teaching (auto-detect / always / off). Asked in `/plan` step 0 on first run only, read silently at every plan/quick start after; `/quick` consumes it but never asks; natural-language changes update it via `mem_update`.
- Optional end-to-end walkthrough before execution: a new `/plan` phase 5 between slice-plan approval and execution — the end-to-end narrative, the slice map, and the risks plus frozen ledger decisions — gated on the walkthrough preference. It explains and never reopens; a decision to revisit goes back through the ledger.
- Gap-evidence adaptive teaching: when a request shows a knowledge gap (contradicts current standard practice, or the operator can't say what the ask involves), the flow briefly explains the terrain and recommends the standard path with the why before executing — wired into `/plan` Intent, `/quick` Micro-intent, and the global rules, with a never-gatekeep guard that stays silent when the operator demonstrates knowledge.
- Oso register fix: Colombian Spanish now addresses the operator with tuteo (tú) and natural usted (e.g. "hágale pues"); voseo is banned (no vos, sabés, tenés, querés, podés).

## 0.7.0

Harness audit (5-judge review) — hardening across the rubric, the agents, and the gates:

- Rubric gains operational anchors: soft-trigger thresholds (parameter count, function length, nesting → written justification, never mechanical gates), a countable hard blocker (an abstraction with fewer than two real callers unless a frozen ledger decision names it), file-level single-responsibility, and a stack-translation clause (idioms named in TS/JS, applied in the host language's equivalent).
- Agents rewired: `oso-applier` and `oso-verifier` carry the full rubric; context7 is wired into executable prompts (applier never-guess-a-signature contract, plan/quick decisions verified against current docs); the verifier returns a three-state verdict.
- `/plan` decision rounds close through pre-freeze gates: a battery→ledger reconciliation checklist, an assumption register, and YAGNI citations before the human freezes the ledger.
- `/quick` quality pass now covers the full rubric bar, not a reduced subset.
- Debt-sweep findings are severity-tiered.
- Hooks: wrapper-bypass fix, stale-lock recovery, `log_event` deduplication, and fd-free verify (no `fd` dependency in the verify path).
- Bootstrap: unified CLAUDE.md budget across the install block.
- Cadence precedence: one-question-at-a-time yields to a structured skill's own cadence (e.g. `/plan` decision rounds).

## 0.6.0

- `/plan` gains a Surface mapping phase between Intent and Decision rounds: up to 3 parallel `Explore` subagents build an evidence-based map of what the change touches, and the question battery is generated from that map — every question must cite the code evidence and the consequence of leaving it undecided. The decision-rounds category table is demoted from question generator to blind-spot audit floor, with a fallback to it only when exploration surfaces nothing.
- Engram recall convention: a single `oso/index` observation (one upserted row per change, `status: executing` at Slicing, `status: done` at Close) so resuming a change means searching the index first instead of guessing topic keys. Every ledger, plan, and summary save now carries a rich title (`{topic key} — {human description}`). `/quick` summaries follow the same rich-title rule but are never added to the index.

## 0.5.0

- Model assignments per role: `/plan` orchestrator and the debt-sweep judge pin `opus`; `oso-applier` and `oso-verifier` pin `sonnet`. `/quick` and `quality-pass` keep inheriting the session model. Note: a pinned model is exact, not a minimum — sessions on a higher-tier model will still run pinned components on the pinned tier.

## 0.4.0

Pilot #1 findings (expense-splitter run: 10 slices, 0 false gate blocks, but three quality gaps):

- Debt-sweep is now a pure judge: it reports findings with evidence and never edits; `/plan` must invoke it through the Skill tool (forked subagent — never inline), then an `oso-applier` cleanup assignment fixes the findings, then a fresh sweep confirms. Loop until `clean`.
- Rubric: over-documentation is now an explicit debt marker — zero comments by default, JSDoc only where code cannot be self-evident (with standard description/params/returns shape), why-shaped sentences over trivial code count as WHAT comments, and JSDoc on most exports of a file is itself a violation. (Pilot produced 49 JSDoc blocks across 32 files.)
- Rubric system level: domain logic (validation, normalization, calculation) must live in the domain layer, not UI/component folders.

## 0.3.0

- `/plan` execution is now fully delegated: each slice runs through an `oso-applier` subagent (implements exactly one slice from the frozen ledger; returns a structured `blocked` report instead of ever assuming) and an `oso-verifier` subagent (fresh-context judge with no edit tools — reruns every check itself and returns a verdict with evidence). The orchestrator resolves blocked questions with the human, updates the ledger, and relaunches; it never writes code during execution. `/quick` stays inline. Closes the self-attestation gap flagged by the adversarial review (C9, partially).

## 0.2.0

- `Oso` output style shipped with the plugin: Colombian mentor persona — teaches and corrects with warmth, blocks sloppy work, never agrees without verifying. Persona governs conversation tone only; enforcement stays structural (rubric, hooks, global rules). Activate with `/output-style Oso`.

## 0.1.0

Initial release.

- `/plan` mode: intent → decision rounds with a frozen ledger → vertical slices → sequential apply/verify at zero warnings → debt-sweep close. Ledger and slice summary go into the PR body on request.
- `/quick` mode: micro-intent → fast visible iteration → quality pass close.
- Shared rubric with judgment contract, hard blockers, and anti-over-extraction rules.
- `debt-sweep` skill (forked context, fallow-assisted on TS/JS, rubric-only elsewhere).
- State-gate hooks (pure bash, fail-safe parsing, tokenized commit matcher, JSONL gate telemetry) backed by the `oso-state` helper (lock-protected atomic writes).
- Cross-OS bootstrap: prerequisites, MCP wiring (engram, context7, fallow), plugin install, marker-based CLAUDE.md merge, and backed-up gentle-ai cleanup behind a confirmation prompt.
