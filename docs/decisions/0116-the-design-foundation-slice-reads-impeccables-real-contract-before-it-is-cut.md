# 0116 — The design-foundation slice reads Impeccable's real contract before it is cut

Date: 2026-08-05
Status: accepted
Supersedes: ADR-0046 (its own and `bodies/plan.md`'s undifferentiated `DESIGN.md`/`PRODUCT.md` phrasing for what `init` and `document` each produce; the FIRST-slice structure, the orchestrator-runs-it-directly exception and the front-surface absence policy it establishes all stand unchanged)
Implemented-in: plugin/skills/_shared/bodies/plan.md, plugin/skills/_shared/front-surface.md, docs/decisions/0046-front-surface-design-bar.md, docs/blueprint.md, tests/plugin-lint.sh, tests/hooks-test.sh, README.md
Reconciled: applied — §4's design-foundation-slice paragraph and Wave 0 bullet now attribute `PRODUCT.md` to `init` and `DESIGN.md` to `document`, require reading the installed `SKILL.md` and recording its version in the ledger before the slice is cut, and name the front-surface absence policy as the lane for when that read cannot happen; `tests/plugin-lint.sh` gained a rule (16) holding the paragraph to it.
Source: the operator's real greenfield Astro-landing-page `/plan` run — Wave 0 was planned as "generate DESIGN.md via Impeccable init", approved, then found wrong against the installed contract only at execution, sending the operator back through Plan Mode to re-approve a corrected plan over their objection ("como así? no entiendo para qué necesitas el plan mode otra vez?"). Confirmed against the installed `~/.agents/skills/impeccable/SKILL.md`, version 4.0.2, and `reference/init.md`, `reference/document.md`, `reference/new-work.md` on this machine.

## Decision

`SKILL.md`'s own Commands table settles it: `init` | Build | Capture durable product context in `PRODUCT.md`, and `document` | Build | Generate `DESIGN.md` from existing project code. `reference/init.md` says the same thing in prose — "`init` captures durable product truth in PRODUCT.md. It does not invent a visual world and does not write DESIGN.md" — and `reference/new-work.md` closes the gap for a brand-new visual world: on a new or replacement world, `DESIGN.md` is written at finish, from the built world, by the shipped documenter, never up front. `init` never writes `DESIGN.md`; only `document`, scanning existing code, does.

§4's design-foundation-slice paragraph now says so explicitly, and adds the read that would have caught the incident before approval: before the slice is cut, read the installed skill's `SKILL.md` and record the version its frontmatter carries in the ledger — the version slice B14's pin must later reconcile against (D14). Wave 0's promise is corrected to match: it writes `PRODUCT.md` always, `DESIGN.md` only when `document` ran against existing code, and a genuinely greenfield project — no code yet for `document` to scan — gets `PRODUCT.md` alone from `init`; that project's `DESIGN.md` is not written until a later slice's own build gives the shipped documenter something to record, so no later wave is coached against a `DESIGN.md` Wave 0 could never have produced for it.

When Impeccable is not installed, the read cannot happen — no version to record, no design-foundation slice to cut. `front-surface.md`'s existing absence policy already covers exactly this: name the gap, give the remedy, continue without the design bar, recorded in the ledger. This decision extends that one paragraph to name the version-read explicitly rather than adding a second absence check beside it.

## Context

Two independent defects produced the incident; this is the first. The false contract was never read: §2, §3 and §4 planned Wave 0 from `bodies/plan.md`'s own memory of Impeccable's contract, and nothing in the read-only planning phases opened `SKILL.md` before the approval gate closed — reading a file is legal in Plan Mode, nothing forbade it, nobody said to. `docs/decisions/0046-front-surface-design-bar.md` carried the same undifferentiated slash-grouping (`init` or `document`; `DESIGN.md`/`PRODUCT.md` carried together) that let the false claim stand unchallenged; its header now names this file as the partial supersession, and its own decision paragraph keeps its original words.

The deeper consequence the incident exposed: for a genuinely greenfield front project there is no code to `document`, so `DESIGN.md` cannot exist at Wave 0 at all, which made the old promise — "later slices are coached against the `DESIGN.md` it generates" — unachievable for exactly the case that most needs a design bar. This decision does not build a mechanism to manufacture a greenfield `DESIGN.md` earlier than Impeccable itself would (that belongs to `new-work`'s own build-time seeding, out of this slice's scope); it corrects the promise to state honestly what Wave 0 actually guarantees.

## Consequences

- A future planner reads the installed contract before committing to what a design-foundation slice will produce, instead of trusting this file's own prose about it.
- The recorded version gives slice B14's pin something to reconcile against; a read nobody recorded would have left that pin guessing.
- A greenfield front project's Wave 0 promise is now honest: `PRODUCT.md` is guaranteed, `DESIGN.md` is not, and later slices are coached against whichever actually landed.
- Impeccable's absence still costs nothing but the design bar itself — this decision adds no second way for that absence to be handled.
