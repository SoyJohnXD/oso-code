# Changelog

## 0.1.0

Initial release.

- `/plan` mode: intent → decision rounds with a frozen ledger → vertical slices → sequential apply/verify at zero warnings → debt-sweep close. Ledger and slice summary go into the PR body on request.
- `/quick` mode: micro-intent → fast visible iteration → quality pass close.
- Shared rubric with judgment contract, hard blockers, and anti-over-extraction rules.
- `debt-sweep` skill (forked context, fallow-assisted on TS/JS, rubric-only elsewhere).
- State-gate hooks (pure bash, fail-safe parsing, tokenized commit matcher, JSONL gate telemetry) backed by the `oso-state` helper (lock-protected atomic writes).
- Cross-OS bootstrap: prerequisites, MCP wiring (engram, context7, fallow), plugin install, marker-based CLAUDE.md merge, and backed-up gentle-ai cleanup behind a confirmation prompt.
