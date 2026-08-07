# Milestone reporting

Shared contract for what the orchestrator tells the operator while `/plan`, `/quick` and `/debug` run autonomously — the gap this file closes is that nothing else in the harness says what a report CONTAINS, so a model left to its own judgment satisfies "report the result" with exactly that sentence and the operator is left reading tool calls and nothing else. Referenced by path from every flow body's own arm, launch, verdict-read, judge-outcome and close moments, so there is one definition, never a copy.

## Milestones

Five moments, each reported AS IT HAPPENS — never batched, never deferred to a later summary:

- **Arming** — before a slice or wave becomes active: name which slice (or `wave-<n>`) and its Goal in one line — what it delivers, never how.
- **Launching** — before a delegation's result comes back: name the role handed the work (`oso-applier`, `oso-verifier`, the wave integrator, or the judge invoked), the assignment given to it in one clause, and the tree it runs in — the worktree path, or the main checkout.
- **Reading a verdict** — once applier, verifier or integrator returns: name the verdict itself — pass, fail, or blocked — plus the ONE fact that decided it: the failing check, the blocking question, the conflicting file. Never a summary of the whole report; the fact that decides, and nothing beside it.
- **A judge's outcome** — once debt-sweep, the conformance axis, doubt-pass, security-pass, triage or quality-pass returns: name the verdict token(s) it ended on and, when findings exist, their count per axis — never the findings themselves, which already travel their own route to the operator. The named residual below is the one exception, and it is reported at the close, never here.
- **Closing** — once a slice or wave lands: name what shipped (the goal delivered), the commit it landed as (or "no commit" and why, per the ledger's Verification row), what runs next, and any named residual a judge's loop left behind.

## Length bound

At most 3 lines per milestone, plain text, no header of its own, no restatement of the tool call that produced it and no paraphrase of a judge's full report. State the fact the operator needs, not a narrative around it: "Slice 3/7 armed — wire the retry queue" is the whole report; a paragraph explaining why it matters is not. This harness's own register is terse, and a contract that traded silence for narration would only swap the operator's complaint for a different one.

## The named residual — the one exception to both rules above

A judge's loop is allowed to end with its lowest tier of findings still open, and the mode that ran it NAMES what it left rather than dropping it: the debt sweep's `nit` residual (`bodies/plan.md` §7, `bodies/debug.md` §5) and the design audit's P2/P3 residual (`_shared/front-surface.md`) each land in that mode's own record. Such a residual also reaches the operator VERBATIM at the close — every finding as the judge wrote it, never a count and never a paraphrase — and that list alone is exempt from the bound above, because a residual trimmed to fit is a residual nobody can act on. It excepts those two rules and no others: the same loop's rounds are still reported as counts while it runs, and every other milestone keeps its three lines.

## Delivery

A milestone report is operator-facing content: it follows the same delivery contract the platform file states for every other one — it ends the turn as plain text, never precedes a tool call in the same turn. What a host's own UI does or does not surface alongside a launch is a fact about that host, never about this contract, and it is bound once per host under `platform/claude/reporting.md` and `platform/codex/reporting.md`.
