# Milestone reporting

Shared contract for what the orchestrator tells the operator while `/plan`, `/quick`, `/debug` and `/roadmap` run autonomously.

## Milestones

Six moments, each reported AS IT HAPPENS — never batched, never deferred to a later summary:

- **Arming** — before a slice or wave becomes active: name which slice (or `wave-<n>`) and its Goal in one line — what it delivers, never how; an armed slice or fix also names its route (inline or the applier) and why.
- **Launching** — before a delegation's result comes back: name the role handed the work (`oso-applier`, `oso-verifier`, the wave integrator, or the judge invoked), the assignment given to it in one clause, and the tree it runs in — the worktree path, or the main checkout.
- **Reading a verdict** — once applier, verifier or integrator returns: name the verdict — pass, fail, or blocked — plus the ONE fact that decided it: the failing check, the blocking question, the conflicting file. Never a summary of the whole report.
- **A judge's outcome** — once debt-sweep, the conformance axis, doubt-pass, security-pass, triage or quality-pass returns: name the verdict token(s) it ended on and, when findings exist, their count per axis — never the findings themselves, which travel their own route to the operator. The named residual below is reported at the close, never here.
- **Closing** — once a slice or wave lands: name what shipped, the commit it landed as (or "no commit" and why, per the ledger's Verification row), what runs next, any named residual a judge's loop left behind, and an escalated slice or fix as such.
- **A child's disposition** — the ROADMAP mode's alone: once one of its children ends, name the child, the word it ended on — CLOSED or SET ASIDE — the reason where it is SET ASIDE, and what the chain arms next or that it arms nothing. It reaches the session stream only, never interrupting an absent operator (`roadmap/SKILL.md` §5).

## Length bound

At most 3 lines per milestone, plain text, no header of its own, no restatement of the tool call that produced it and no paraphrase of a judge's full report.

## Two exceptions to the bound above, and the list is closed

**The named residual**, which excepts the judge's-outcome count rule as well. A judge's loop may end with its lowest tier of findings still open; the mode that ran it NAMES what it left: the debt sweep's `nit` residual (`plan/SKILL.md` §7, `debug/SKILL.md` §5) and the design audit's P2/P3 residual (`_shared/front-surface.md`), each landing in that mode's own record. It reaches the operator VERBATIM at the close — every finding as the judge wrote it, never a count or a paraphrase — and that list alone is exempt from the bound. The loop's rounds are still reported as counts while it runs.

**An absent-operator run's final report**, which excepts the bound alone: one report over everything the operator missed — what was decided for them and on what rationale, what was deferred and why, and what awaited their hand. TWO runs produce one: the ROADMAP mode's §5, over its whole queue, and a plan run under its own AUTO disposition (`plan/SKILL.md` §7), over the one change, at whichever end it reached — the close or the park. Every milestone in either run keeps its three lines, a child's disposition included; the ordered queue the roadmap's report heads is operator-facing content, never a milestone report.

## The threshold for work the flow writes

Work touching one non-trivial file, or a mechanical edit of any breadth, is written INLINE; two or more non-trivial files, or work that crosses a contract between layers, goes to the applier agent. When you write inline, follow the applier agent file's rules, producing its `proof:`, `scan:`, `decisions_used:` blocks as `applier_proof`.

## Delivery

A milestone report is operator-facing content: it follows the delivery contract the reference file states — it ends the turn as plain text, never precedes a tool call in the same turn. What a host's UI surfaces alongside a launch is bound once per host under `_shared/references/claude.md` and `_shared/references/opencode.md`.

A host's reference file MAY carve an UNATTENDED RUN out of that rule, its milestones riding the stream instead of ending the turn. A host that does states the carve-out whole: what marks a run unattended, what the stream then costs, and which deliveries still end the turn — at minimum the park and the final report, each handing the run back. Each milestone of such a run is ALSO appended full-text to the run's own journal (`oso-state journal`), the record an operator reads on return and a compaction cannot take. Where a host carves out nothing, every milestone ends the turn.

## The model profile behind those launches

When this project's `oso/preferences` record names a `model_profile`, say in one line that a host taking its delegate models from its own installed config follows that record only after `oso profile set <name>` and that host's install both run from this project's directory.
