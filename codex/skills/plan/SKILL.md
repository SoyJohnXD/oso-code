---
name: plan
description: "Deep mode for substantial changes. Plans in four phases — intent, surface mapping, decision rounds, slicing — inside Plan Mode, closes with a Repaso-headed approval document, then executes slice by slice with an apply/verify loop and a zero-warnings bar. Use for features, refactors, or any change that needs architecture or contract decisions."
argument-hint: "[change-name or what to build]"
disable-model-invocation: true
---

# Plan mode

This mode's instructions live in two files. READ BOTH NOW, in this order, and follow them as binding — as if their text stood here. Both paths resolve against the directory holding this file:

1. `../_shared/bodies/plan.md` — the flow itself: the phase contracts, the reconciliation gates, the ledger discipline, the verdict vocabularies. It is the same on every host this harness runs on.
2. `../_shared/platform/codex/plan.md` — what the flow leaves to the host: the tools it calls, the paths it resolves, the approval gate, the state command, and the installed runtime gates.

Where the neutral body defers to "your host", the platform file is the answer, and it is the only answer.
