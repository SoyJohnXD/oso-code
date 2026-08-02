---
name: debt-sweep
description: Whole-change judge after functionality is confirmed, on two axes — code debt (dead code, duplication, over-documentation, rubric violations) and ledger conformance (the assembled change against the frozen decisions that shaped it). Reports both with evidence in separate sections — it never edits anything; fixes are applied by a separate applier. Use when a plan-mode change is complete, or when the user asks to sweep a branch or recent work for debt.
argument-hint: "[base ref, e.g. main] [+ frozen ledger: bare decisions + scope]"
context: fork
agent: general-purpose
background: false
model: opus
---

# Debt sweep

This judge's instructions live in two files. READ BOTH NOW, in this order, and follow them as binding — as if their text stood here:

1. `${CLAUDE_SKILL_DIR}/../_shared/bodies/debt-sweep.md` — the judgment itself: the scope rule, the two axes, the finding shape, the verdict vocabulary. It is the same on every host this harness runs on.
2. `${CLAUDE_SKILL_DIR}/../_shared/platform/claude/debt-sweep.md` — what the judgment leaves to the host: the paths it interpolates, and the route to the fallow tools.

Where the neutral body defers to "your host", the platform file is the answer, and it is the only answer — never improvise a spelling the platform file does not give.
