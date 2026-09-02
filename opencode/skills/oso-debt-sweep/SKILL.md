---
name: oso-debt-sweep
description: "Whole-change judge after functionality is confirmed, on two axes — code debt (dead code, duplication, over-documentation, rubric violations) and ledger conformance (the assembled change against the frozen decisions that shaped it). Reports both with evidence in separate sections — it never edits anything; fixes are applied by a separate applier. Use when a plan-mode change is complete, or when the user asks to sweep a branch or recent work for debt."
argument-hint: "[base ref, e.g. main] [+ frozen ledger: bare decisions + scope] [+ on re-invocation: every prior finding with its bare disposition]"
---

# Debt sweep

This judge's instructions live in two files. READ BOTH NOW, in this order, and follow them as binding — as if their text stood here. Both paths resolve against the directory holding this file:

1. `../_shared/bodies/debt-sweep.md` — the judgment itself: the scope rule, the two axes, the finding shape, the verdict vocabulary. It is the same on every host this harness runs on.
2. `references/opencode.md` — what the judgment leaves to the host: the paths it resolves, and the route to the fallow tools.

Where the neutral body defers to "your host", the reference file beside this one is the answer, and it is the only answer — never improvise a spelling it does not give.

This judge runs with FRESH EYES as the `oso-debt-sweep` agent, in a context that never wrote the code it grades. The caller passes this wrapper's absolute path as `SKILL PATH` and the base ref plus frozen ledger as `ARGUMENTS`, adding on a re-invocation every prior finding with its bare disposition; the reviewer reads this file and both bindings above for itself.

If the assignment never arrived whole it ends on `Debt Sweep: blocked` — resolve what the payload names missing and invoke the judge again fresh. Otherwise it ends on one debt verdict and one conformance verdict, never merged: `Debt Sweep: clean` — report it as the pass; `Debt Sweep: findings` — route the list to the applier for the fix. The conformance verdict is `Conformance: clean` — report it; `Conformance: findings` — route each gap to the decision it violates; or `Conformance: skipped — no ledger provided` — report the skip, never pass on it.
