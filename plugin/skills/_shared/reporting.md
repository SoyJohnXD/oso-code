# Milestone reporting

Shared contract for what the orchestrator tells the operator while `/plan`, `/quick`, `/debug` and `/roadmap` run autonomously.

## Milestones

Six moments, each reported AS IT HAPPENS — never batched, never deferred to a later summary:

- **Arming** — before a slice or wave becomes active: name which slice (or `wave-<n>`) and its Goal in one line — what it delivers, never how.
- **Launching** — before a delegation's result comes back: name the role handed the work (`oso-applier`, `oso-verifier`, the wave integrator, or the judge invoked), the assignment given to it in one clause, and the tree it runs in — the worktree path, or the main checkout.
- **Reading a verdict** — once applier, verifier or integrator returns: name the verdict itself — pass, fail, or blocked — plus the ONE fact that decided it: the failing check, the blocking question, the conflicting file. Never a summary of the whole report; the fact that decides, and nothing beside it.
- **A judge's outcome** — once debt-sweep, the conformance axis, doubt-pass, security-pass, triage or quality-pass returns: name the verdict token(s) it ended on and, when findings exist, their count per axis — never the findings themselves, which already travel their own route to the operator. The named residual below is the one exception, and it is reported at the close, never here.
- **Closing** — once a slice or wave lands: name what shipped (the goal delivered), the commit it landed as (or "no commit" and why, per the ledger's Verification row), what runs next, and any named residual a judge's loop left behind.
- **A child's disposition** — the change level, and the ROADMAP mode's alone: once one of its children ends, name the child, which of that mode's two words it ended on — CLOSED or SET ASIDE — the reason where the word is SET ASIDE, and what the chain arms next or that it arms nothing. It reaches the session stream and stops there: `roadmap/SKILL.md` §5 fixes the three moments allowed to interrupt an absent operator, and a child ending is deliberately not one of them.

## Length bound

At most 3 lines per milestone, plain text, no header of its own, no restatement of the tool call that produced it and no paraphrase of a judge's full report. State the fact the operator needs, not a narrative around it: "Slice 3/7 armed — wire the retry queue" is the whole report; a paragraph explaining why it matters is not.

## Two exceptions to the bound above, and the list is closed

**The named residual**, which excepts the count rule of the judge's-outcome milestone as well. A judge's loop is allowed to end with its lowest tier of findings still open, and the mode that ran it NAMES what it left rather than dropping it: the debt sweep's `nit` residual (`plan/SKILL.md` §7, `debug/SKILL.md` §5) and the design audit's P2/P3 residual (`_shared/front-surface.md`) each land in that mode's own record. Such a residual also reaches the operator VERBATIM at the close — every finding as the judge wrote it, never a count and never a paraphrase — and that list alone is exempt from the bound above. It excepts those two rules and no others: the same loop's rounds are still reported as counts while it runs, and every other milestone keeps its three lines.

**An absent-operator run's final report**, which excepts the bound alone. A run the operator was absent for ends with one report over everything they missed — what was decided for them and on what rationale, what was deferred and why, and what awaited their hand. TWO runs produce one: the ROADMAP mode's §5, over the whole queue of changes it ran, and a plan run under its own AUTO disposition (`plan/SKILL.md` §7), over the one change, at whichever end that run reached — the close or the park. Nothing else in either run is: every milestone above keeps its three lines while the work runs, a child's disposition included, and the ordered queue the roadmap's report heads was never a milestone report at all — it is operator-facing content the way a plan document is, which this contract has never bounded.

## Delivery

A milestone report is operator-facing content: it follows the same delivery contract the reference file states for every other one — it ends the turn as plain text, never precedes a tool call in the same turn. What a host's own UI does or does not surface alongside a launch is a fact about that host, never about this contract, and it is bound once per host under `_shared/references/claude.md`, `_shared/references/codex.md` and `_shared/references/opencode.md`.

A host's reference file MAY carve an UNATTENDED RUN out of that delivery rule — a run whose milestones ride the stream instead of ending the turn. Where a host does, its own file states the carve-out whole: what marks a run unattended, what the stream then costs, and which deliveries still end the turn — the park and the final report, at minimum, since each hands the run back rather than reporting it. What replaces the interrupted stream is the same thing on every host that takes the carve-out: each milestone is ALSO appended full-text to the run's own journal (`oso-state journal`), the durable record an operator reads on their return and the only one a compaction cannot take. Where a host carves out nothing, every milestone above ends the turn exactly as this section opens.

## The model profile behind those launches

When this project's `oso/preferences` record names a `model_profile`, say in one line that a host taking its delegate models from its own installed config follows that record only after `oso profile set <name>` and that host's install both run from this project's directory.
