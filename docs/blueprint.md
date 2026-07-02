# oso-code — Blueprint

Frozen design for the oso-code harness. Amendments require a new decision, not a silent edit.

## Amendments

- 2026-07-02, execution model (user decision): `/plan` execution is delegated, gentle-style — an `oso-applier` subagent per slice (fed the frozen ledger; blocked-and-return instead of assuming; orchestrator resolves questions with the human and relaunches fresh) and an `oso-verifier` subagent per slice (no edit tools; independent rerun of every check; verdict with evidence gates `verify_green`). The orchestrator never writes code during execution. `/quick` remains inline.

- 2026-07-02, after adversarial review: hooks are pure bash (no runtime jq dependency) and log every gate event to `~/.local/state/oso-code/events.jsonl`; the commit matcher is tokenized (flag-tolerant, quote-safe); `oso-state` writes are lock-protected and atomic; `/plan` re-arms runtime state on resume; on PR creation the frozen ledger and slice summary are copied into the PR body (engram remains the store of record); the rubric regains a hard-blockers floor (secrets, swallowed errors, callerless abstractions). Platform facts verified against docs and this machine: the model can enter Plan Mode itself (`EnterPlanMode` tool, not available to subagents), and the session env var is `CLAUDE_CODE_SESSION_ID`.

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

Planning runs entirely in native Plan Mode (read-only, harness-enforced).

1. **Intent** — understand WHAT the user wants at a high abstraction level. No code, no how. Output: intent statement + in-scope/out-of-scope. Human approves.
2. **Decision rounds** — as many rounds as complexity demands. Each round: 3–5 questions with options and tradeoffs. Everything lands in a **decision ledger**: contracts, architecture, data model, error handling. Exit: category checklist covered + human declares the ledger frozen. The agent never assumes — an uncovered decision during execution stops the work and returns to the human.
3. **Slicing** — vertical slices, each with a goal, estimated files, and its own verify criteria. Human approves → exit Plan Mode.

**Execution:** one slice at a time, sequential. Apply → verify (zero warnings: lint, types, tests, build as the project defines) → loop until green → next slice.

**When the user says they are happy:**

4. **Debt-sweep** — verify pass with fallow (`find_dupes`, `get_cleanup_candidates`, `audit`) plus the clean-code rubric: dead code, stray comments, duplication, poor naming. Then a cleanup apply that never touches functionality — readability, semantics, and established patterns only. Re-verify.
5. **Close** — commit/push/PR only if the user asks. Session summary to engram.

## Mode 2 — `/quick` (fast iteration)

- **Micro-intent**: one exchange — what and what visible success looks like. If the orchestrator detects the change is substantial, it recommends `/plan` with the reason; the human decides.
- Rapid inline iteration with visible results (run the app, screenshot).
- On "done": quality pass — rubric verify + alignment apply + zero warnings.

## Hooks (state, not content)

- Block `git commit` while the slice/session verify is not green.
- Block Edit/Write in mode 1 when no slice is active.
- Runtime flags live in `~/.local/state/oso-code/session.json` (ephemeral, outside projects, deleted on close). Hooks read booleans from it; they never inspect model output.

## Tool policy

| Tool | When | Never |
|---|---|---|
| fallow | Debt-sweep only, loaded by the debt-sweep subagent | Planning, slice verify, main context |
| context7 | A slice touches an external library and the API is in doubt | By default |
| engram | Frozen decision ledger (one save), plan state (one upserted topic key), session summary, discovered conventions/gotchas | Explorations, intermediate phase artifacts, verbose progress |

## Bootstrap responsibilities

1. Prerequisites (runtime) per OS: Linux, macOS, Windows.
2. MCP install and wiring verification: engram, context7 (fallow configured for debt-sweep use).
3. Legacy cleanup: remove gentle-ai configs, hooks, skills, and CLAUDE.md blocks. Known duplication to kill: engram protocol (currently in three places), persona (currently in two).

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
