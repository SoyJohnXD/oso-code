# 0079 — Waves, and the two boundaries the graph does not draw

Date: 2026-08-02
Status: accepted
Implemented-in: plugin/skills/plan/SKILL.md
Reconciled: applied — Mode 1 phase 4 groups the graph into waves and phase 5 presents each slice under the wave it runs in.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

A WAVE is a set of slices with no edge between any two of them (ADR-0077), and a wave starts only once the wave before it has landed. Two of its boundaries are structural rather than read off the graph: wave 0 is the design-foundation slice ALONE — width 1, in the main checkout, run by the orchestrator itself — and a CONTRACT slice may never share a wave with a MIGRATE slice.

## Context

Wave 0 is alone because every later slice is coached against the `DESIGN.md` / `PRODUCT.md` it generates (ADR-0046), so no later wave may branch from the base ref until it has landed there. The CONTRACT barrier is ADR-0049's pre-delete completeness check read under concurrency: run beside a MIGRATE sibling it greps a tree that sibling's migrations have not reached, and a search that finds no consumers because they are still in flight reports zero for the wrong reason. The wave is a grouping inside the plan record — slices carry their wave in `oso/{change}/plan` — and never a new `oso/index` status: ADR-0016's four-word vocabulary is untouched.
