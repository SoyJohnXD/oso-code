# 0126 — Wave 1's WAVE START accounts for a wave 0 that already landed

Date: 2026-08-06
Status: accepted
Supersedes: ADR-0118 (its "Wave 1's WAVE START is the CHANGE BASE §3 recorded" clause — that held only when no design-foundation slice ran; every other coordinate ADR-0118 names stands unchanged)
Implemented-in: plugin/skills/_shared/bodies/plan.md, tests/plugin-lint.sh
Reconciled: applied — the Wave 0 bullet (§4), the Cut-one-worktree-per-slice paragraph (§6) and the "Three coordinates" paragraph (§6's own preamble, corrected after this ADR's first landing missed it) all read the corrected coordinate; `tests/plugin-lint.sh`'s guard scans every line of `plugin/skills/_shared/bodies/plan.md` naming wave 1 rather than two hardcoded paragraph anchors, so it reaches this site and any future one the same way.
Source: this change (codex-fluidity), round 2 of the close, debt-sweep confirmation run; ledger decision D8 (extended, not contradicted) and D16 (per-slice commits are the orchestrator's)

## Decision

Wave 1's WAVE START is the main checkout's own HEAD the moment wave 1 arms, never unconditionally CHANGE BASE:

- **No wave 0 ran.** Nothing has committed to the main checkout since CHANGE BASE, so HEAD and CHANGE BASE name the same commit — cutting from either reads identically, and ADR-0118's original text stood correct for this case.
- **Wave 0 ran.** The design-foundation slice is the one slice the orchestrator commits directly to the main checkout rather than through step 4's applier/verifier loop (its own per-slice commit, ADR-0093) — that commit is what moved HEAD past CHANGE BASE, and wave 1's own worktree must contain it: a front-touching wave-1 slice's payload already promises the applier `PRODUCT.md`/`DESIGN.md` as conventions (§6 step 2), and a worktree cut from CHANGE BASE alone would hand it neither file.

Wave 1 learns wave 0's landing commit the same way SEQUENTIAL's own SLICE START already resolves `HEAD` without a report: by reading the main checkout's own HEAD. No new field and no new report is required, because nothing else can have written to the main checkout between CHANGE BASE and wave 1's first worktree cut — wave 0 is a width-1, main-checkout-only wave with no `oso-integrator` invocation over it, so no `next_wave_start` is ever produced or needed for it; the orchestrator performed wave 0's own commit itself and so already holds the value the moment it needs it.

## Context

`plugin/skills/_shared/bodies/plan.md` carried two statements that could not both hold: the Wave 0 bullet (§4) promised "no later wave branches from the base ref until [the design-foundation slice] has landed there," while the Cut-one-worktree-per-slice paragraph (§6) stated flatly that "Wave 1's WAVE START is the CHANGE BASE §3 recorded" — with no exception for a wave 0 that ran. When wave 0 exists, it commits directly to the main checkout and moves HEAD past CHANGE BASE; wave 1's worktree, cut unconditionally from CHANGE BASE, would then contain neither `PRODUCT.md` nor `DESIGN.md`, breaking exactly the greenfield front-surface case §6 step 2's own front-slice payload bullet assumes is satisfied.

ADR-0118's own Context asserted the pre-existing `worktree add` already made the wave-0→wave-1 claim true, "for wave 1 relative to wave 0's direct commit to the main checkout" — but the git command it was describing cut every worktree from the single CHANGE BASE regardless of whether wave 0 had run, so that claim was never true; ADR-0118's Decision then carried the same wrong assumption forward into the unconditional "Wave 1's WAVE START is the CHANGE BASE" sentence this decision retires. The debt-sweep's confirmation run caught the resulting contradiction between §4's promise and §6's mechanism.

## Consequences

- A wave-1 slice — front-touching or not — cut after a design-foundation wave 0 now actually contains what that slice landed, closing the gap the Wave 0 bullet's own promise asserted but the wave loop's git command never carried out.
- `tests/plugin-lint.sh` gains `check_wave_1_wave_start_accounts_for_wave_0` (rule twenty-two): it scans every line of the plan body naming wave 1 — the one term that file uses nowhere else — and holds each to naming WAVE START by name (never the ambiguous "the base ref" phrasing whose imprecision is what let this hole open) and to conditioning the CHANGE BASE claim on wave 0 rather than stating it flatly again. Scanning by content rather than by two hardcoded paragraph anchors is what caught the third site this decision's own first landing missed.
- `docs/blueprint.md`'s index gains this decision under the existing 2026-08-05 — codex-fluidity heading.
