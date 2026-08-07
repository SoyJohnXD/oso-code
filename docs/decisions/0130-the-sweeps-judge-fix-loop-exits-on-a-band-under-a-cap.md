# 0130 — The debt sweep's judge → fix loop exits on a severity band under a hard cap

Date: 2026-08-07
Status: accepted
Supersedes: ADR-0071 (its "loops judge-to-fix until `Debt Sweep: clean`" clause alone — the loop now ends on a severity band under a cap; the sweep's additive standing beside the quality pass, its no-ledger `Conformance: skipped` contract and the quality-pass re-run over the cleanup all stand unchanged)
Reconciled: applied — Mode 1 §7 step 3 and Mode 3 §5 step 1 each state the band, the cap and the three routes; the greens at Mode 1 §7 step 7 and Mode 3 §5 step 4 read that bar instead of a token; the front-surface matrix's PLAN cell points at the bar rather than restating a token the bar can no longer produce; `_shared/reporting.md` carries the residual's reporting exception; and `tests/plugin-lint.sh` holds both the bar's own clauses and the surfaces that must not restate the retired one.
Source: this change (clean-bar-convergence); one real close that ran seven judge → fix rounds over three hours, whose last three rounds found only the damage the fifth round's own applier had left; ledger decision D3

## Decision

The debt sweep's judge → fix loop ends on a severity BAND, never on an empty findings list:

- **The band.** No `blocker` and no `structural` finding still open on the debt axis. `Conformance: clean` keeps the whole bar on the other axis, because its four tags carry no tier — there is no lowest conformance finding a close may leave standing.
- **The residual is named, never dropped.** A `nit` still open when the band is met is the loop's NAMED RESIDUAL: recorded where the mode records things (`/plan` → the ledger, `/debug` → the close's session summary) and relayed to the operator verbatim at the close, under the residual exception in `plugin/skills/_shared/reporting.md`. A named residual is not an edit the bar has not seen, so it never re-reds the green: nothing was written for it.
- **A hard cap of three rounds.** Past the third the loop is repairing its own repairs rather than the change.
- **At the cap, the operator picks from exactly three routes**, and the orchestrator never picks for them: accept the residual as it stands, grant a stated number of further rounds, or send the remainder back to the flow's own apply/verify path — `/plan` §6 as its own slice, `/debug` §4 as its own apply/verify pass. A cap of two was rejected: two rounds is one judge plus one fix plus one confirmation, which is the shortest run that can converge at all, so capping there would send ordinary closes to the operator. Recording the cap in memory alone, with no bar in the body, was rejected for the same reason the old wording failed — a loop whose exit lives outside the instruction is a loop with no exit.

The cap binds the debt sweep's loop and nothing else. The quality-pass re-run, the security-pass re-review and the design audit each keep their own exit.

## Context

`until clean` reads as a bar and behaves as one only while the fixer is infallible. Put a fallible applier inside it and the loop stops converging: each round's own edits are new surface for the next round to find, so a close can grind for hours over findings that did not exist when it started, and the operator has no seam to step into because the instruction offers none. The measured case ran seven rounds; rounds five through seven found only what round five had written.

Naming a band rather than a count is what keeps the shortening honest. The findings that must close are the ones that would ship a defect — `blocker` and `structural`; the tier that may stay is the one whose whole cost is readability, and it stays VISIBLE rather than silently forgiven. Without the naming rule the band would be an amnesty; with it, the close still ends with the operator knowing exactly what the loop left.

ADR-0062 stands untouched: `/plan`'s close still reads both verdicts by name, and `Conformance: skipped — no ledger provided` is still never a pass. What changed is only what the loop waits for — a band, not a token.

## Consequences

- Any surface that stated the old exit condition had to move with the bodies, and one that did not is a live contract stating a precondition the bar can no longer produce: `plugin/skills/_shared/front-surface.md`'s PLAN cell gated the design audit on the sweep RETURNING `Debt Sweep: clean`, so a close ending in a nit residual would have skipped that audit silently. It now points at the bar instead.
- `docs/blueprint.md`'s Mode 1 §7 narrative reads the band, the residual and the cap rather than "until both axes are clean".
- ADR-0071's loop clause is retired; its frontmatter and this file's `Supersedes:` line record which clause and which parts still stand. Its body stays as written.
- `tests/plugin-lint.sh`'s `check_sweep_exit_bar_is_banded_and_capped` holds both halves of this decision: the bar's own clauses in each body, and the caller surfaces that must not restate `Debt Sweep: clean` as the whole of the debt axis's pass.
