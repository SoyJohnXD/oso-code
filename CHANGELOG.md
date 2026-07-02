# Changelog

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
