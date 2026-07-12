# Changelog

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
