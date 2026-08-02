# 0082 — The integration gate is an `oso-verifier` run with a second verdict shape

Date: 2026-08-02
Status: accepted
Implemented-in: plugin/agents/oso-verifier.md, plugin/skills/_shared/bodies/plan.md
Reconciled: applied — Mode 1 phase 6 names the integration gate over the merged tree and the shape it answers in.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

After a wave merges, `oso-verifier` runs over the merged main checkout as the integration gate, in a SECOND verdict shape: the merged tree is the goal, and the criteria are the project's full bar plus one `failing-check` line per slice of the wave, none omitted, each reported as `holds`, `broken-by-the-merge` or `exception-declared`. That shape carries no `failing-check quality` line. The wave closes only on its `pass`.

## Context

Every slice was judged green ALONE, in its own worktree; nothing had judged the tree they add up to, and a regression check that held alone is exactly what a sibling merged beside it can break — which is why every slice's check is re-run here rather than sampled. ADR-0047's judgment of the check's own quality stays at the per-slice gate where the check was written: whether it was new or extended by its slice, and whether it is tautological or implementation-coupled, was settled there, and a merge cannot turn an independent behavioral check into a tautological one. What the re-run reads is ADR-0037's failing check, at the one point in the flow where nothing else would.
