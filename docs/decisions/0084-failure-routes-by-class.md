# 0084 — Failure inside a wave routes by class

Date: 2026-08-02
Status: accepted
Implemented-in: plugin/skills/_shared/bodies/plan.md
Reconciled: applied — Mode 1 phase 6 routes the three classes and reads stop-the-line against the whole wave.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

Three classes, none borrowing another's route. A RED SLICE stays in its worktree: the applier is relaunched there with the verifier's findings and the pair loops as §6 step 3 does, while its siblings run on. A MERGE CONFLICT stops the integrator at the first one and goes to the operator with the conflicting files, the slices whose work meets in them, and the conflicted tree exactly as git left it — the orchestrator never resolves it and never edits either side. A RED INTEGRATION returns the WHOLE WAVE as a unit, and the fix enters as a NEW SLICE through the normal apply → verify loop. Under PARALLEL, ADR-0043's stop-the-line reads "the active slice" as the WAVE: only breakage unrelated to the entire wave takes that route.

## Context

A red integration is not attributable to the slice whose regression check failed: that check names the slice whose BEHAVIOUR broke, never the slice that broke it, so sending that slice back is sending the victim. The fix enters as a slice for the reason ADR-0062 gives an `Unimplemented` conformance finding — work no failing-check gate ever saw may not land under a green. A conflict goes to the operator because which side wins is a decision about the change, and decisions are the operator's; nothing the integrator was handed says which. Every abnormal branch here leaves an audit line through ADR-0089's `event` verb.
