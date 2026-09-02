---
name: debug
description: Debugging and error-recovery mode for something that broke. Triages reproduce-first — reproduce, localize, reduce — then delegates the fix and a regression test through the apply/verify loop with a zero-warnings bar. Use when a bug, crash, or failing behavior needs diagnosis; also the landing point when a /plan or /quick ask turns out to be a bug.
argument-hint: [what broke]
disable-model-invocation: true
---

# Debug mode

This mode's instructions live in two files. READ BOTH NOW, in this order, and follow them as binding — as if their text stood here:

1. `${CLAUDE_SKILL_DIR}/../_shared/bodies/debug.md` — the flow itself: reproduce-first triage, the diagnosis freeze, the delegated fix, the close. It is the same on every host this harness runs on.
2. `${CLAUDE_SKILL_DIR}/references/claude.md` — what the flow leaves to the host: the tools it calls, the paths it interpolates, the delivery rule this TUI imposes, the state command the gates read.

Where the neutral body defers to "your host", the reference file beside this one is the answer, and it is the only answer — never improvise a spelling it does not give.
