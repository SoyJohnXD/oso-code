# 0080 — The execution mode is chosen in §4, with the computed width

Date: 2026-08-02
Status: accepted
Implemented-in: plugin/skills/plan/SKILL.md
Reconciled: applied — Mode 1 phase 4 chooses the mode with the widest wave's width, before the approval gate.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

One question at the end of §4 settles the mode: run the slices SEQUENTIALLY in the main checkout, or run each wave in PARALLEL with one worktree per slice. The widest wave's width, the estimated gain and a recommendation travel in the question's own fields — parallel recommended at a width of 3 or more, the number reported and sequential recommended at 2, and the number shown either way. The concurrency cap defaults to 4 and is adjustable at that question. The answer — the mode, and the cap when it is parallel — goes in the ledger.

## Context

It happens in §4 because ADR-0033 makes `ExitPlanMode` the sole approval gate: a mode question after approval would be a second gate, and one before it rides inside the plan the operator is approving anyway. The number stands on the same screen as the answer so a recommendation can be read and overruled, and the arithmetic is stated rather than sold: a wave costs its slowest slice plus one full integration gate, phases §1–§5 and §7 do not parallelize at all, so the gain comes from the widest wave and never from the slice count.
