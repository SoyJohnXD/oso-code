---
name: debug
description: "Debugging and error-recovery mode for something that broke. Triages reproduce-first — reproduce, localize, reduce — then delegates the fix and a regression test through the apply/verify loop with a zero-warnings bar. Use when a bug, crash, or failing behavior needs diagnosis; also the landing point when a plan or quick ask turns out to be a bug."
argument-hint: "[what broke]"
disable-model-invocation: true
---

# Debug mode

This mode's instructions live in two files. READ BOTH NOW, in this order, and follow them as binding — as if their text stood here. Both paths resolve against the directory holding this file:

1. `../_shared/bodies/debug.md` — the flow itself: reproduce-first triage, the diagnosis freeze, the delegated fix, the close. It is the same on every host this harness runs on.
2. `references/codex.md` — what the flow leaves to the host: the tools it calls, the paths it resolves, the state command, and the installed runtime gates.

Where the neutral body defers to "your host", the platform file is the answer, and it is the only answer.
