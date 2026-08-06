# 0118 — Three coordinates replace the single base ref: CHANGE BASE, WAVE START, SLICE START

Date: 2026-08-06
Status: accepted
Supersedes: ADR-0076 (its "cut from the change's base ref" clause — a worktree now cuts from WAVE START, the CHANGE BASE only for the wave that runs first; the worktree location and branch naming stand unchanged), ADR-0087 (its single BASE REF for the ref coordinate in both delegation payloads — three named coordinates split what that ref means by where the payload is built; the WORKTREE PATH pairing and the applier's skipped self-check under parallel stand unchanged)
Implemented-in: plugin/skills/_shared/bodies/plan.md, plugin/skills/_shared/bodies/triage.md, plugin/agents/oso-applier.md, plugin/agents/oso-verifier.md, plugin/agents/oso-integrator.md
Reconciled: applied — Mode 1 phase 6 names all three coordinates and which one each delegated launch carries; the four operational agent files and the triage judge read the same three names.
Source: this change (codex-fluidity), ledger decision D8; found while auditing the wave loop's `git worktree add -b` line and the sequential verifier payload against ADR-0079's own claim that "no later wave branches from the base ref until [the prior one] has landed there" — a claim the wave loop's own git command never carried out

## Decision

Three coordinates replace the wave loop's single base ref, one name per place a diff is judged from:

- **CHANGE BASE** is §3's Verification-row ref, unmoving for the whole change. It is what the close's two judges (§7 — the debt-sweep/conformance judge and the security-pass judge) diff against, exactly as before.
- **WAVE START** is the commit a wave's worktrees are cut from. Wave 1's WAVE START is the CHANGE BASE; every later wave's is the integration commit the previous wave's `oso-integrator` produces on a clean merge, named in its `status: done` report as `next_wave_start` and carried forward by the orchestrator into the next wave's `git worktree add -b`. A conflict or a red integration gate lands no clean merge and therefore no WAVE START: the wave has not closed, so no next wave arms until this one does, through its own failure route (ADR-0084).
- **SLICE START** is what one ACTIVE slice's own novelty is judged against, so a verifier's failing-check contract — "is this new or extended by THIS slice" — has a diff that can answer its own question. Under SEQUENTIAL it is `HEAD`: nothing else commits to the main checkout while that slice is active, only its own step 4 does once it goes green, so the diff is that slice's pending work alone, never a sibling slice already committed beside it. Under PARALLEL it is the WAVE START the slice's own worktree was cut from — a fresh worktree holds nothing before that cut, so the two coincide and the diff is that slice's work alone either way.

`oso-code:triage` compares a red check's evidence against WAVE START, never CHANGE BASE: a breakage an earlier wave already landed into WAVE START is background the wave in flight never introduced, and attributing it to that wave would send the operator to debug a slice that is not theirs to fix through this route.

The SEQUENTIAL path needs SLICE START but never WAVE START — it cuts no worktree, so there is nothing to cut from a wave's own start; its sibling defect was the same root cause read the other way, an applier/verifier payload that never moved off CHANGE BASE across the whole change instead of moving to each slice's own `HEAD`.

## Context

The wave loop cut every worktree from CHANGE BASE regardless of which wave was arming (`git -C <main checkout> worktree add -b oso/<change>/<slice> <worktree root>/<slice> <base ref>`, `<base ref>` always §3's). Wave 2's tree therefore never contained what wave 1 landed: a wave-2 slice depending on a wave-1 contract failed for a reason no slice's diff explained, and the integration gate then judged a merge built on that missing tree. ADR-0079 already claimed "no later wave branches from the base ref until [wave 0] has landed there" — the wave loop's own git command never made that claim true for wave 2 relative to wave 1, only for wave 1 relative to wave 0's direct commit to the main checkout.

The sequential path carried the sibling defect for the same root cause: the verifier's BASE REF never moved between slices, so the diff it judged always carried every already-landed slice beside the one it was asked whether was "new or extended by THIS slice" — a question that diff could not cleanly answer on its own evidence.

Triage inherited the same ambiguity one level up: its `argument-hint` and its one question named "the base ref" with nothing to say which of three a wave in flight now has. Comparing against CHANGE BASE would read an earlier wave's own landed work as this wave's doing — exactly the misattribution the operator would be dispatched to debug.

## Consequences

- A wave-2+ slice that depends on an earlier wave's contract now runs against a tree that actually contains it.
- The sequential verifier's failing-check judgment reads a diff scoped to the one slice in front of it, never a sibling already committed beside it.
- `oso-integrator` gains a `next_wave_start` field on `status: done` — the one new fact its report has to carry, since nothing else in the harness merges a wave and nothing else can therefore name the commit a later wave's worktrees cut from.
- `oso-code:triage` compares against WAVE START; a breakage an earlier wave already landed reads as pre-existing to the wave in flight, correctly, and routes to the operator rather than back into a wave that never caused it.
- `docs/blueprint.md`'s index gains this decision under the existing 2026-08-05 — codex-fluidity heading.
