---
name: oso-quick
description: "Fast iteration mode for small, easily verifiable changes. Runs a one-exchange micro-intent, iterates with visible results, and closes with a quality pass. Use for visual tweaks, small fixes, and adjustments that fit in a handful of files."
argument-hint: "[what to change or fix]"
disable-model-invocation: true
---

# Quick mode

Host precondition: this operator-only skill starts only when the operator
invokes `/oso-quick`. The installed `opencode.json` denies it to the model
(`permission.skill: {"oso-quick": "deny"}`), so the model never sees it and a
model call to the `skill` tool for it is rejected; never imitate the invocation
by printing the command. This instruction is the fallback before that config
has been written by the installer.

This mode's instructions live in two files. READ BOTH NOW, in this order, and follow them as binding — as if their text stood here. Both paths resolve against the directory holding this file:

1. `../_shared/bodies/quick.md` — the flow itself: the micro-intent, the substantiality check, the iteration rules, the close. It is the same on every host this harness runs on.
2. `references/opencode.md` — what the flow leaves to the host: the delivery contract it speaks under, the question rounds it asks in, the tools it calls, the paths it resolves, the state command, and the installed runtime gates.

Where the neutral body defers to "your host", the platform file is the answer, and it is the only answer — never improvise a spelling the platform file does not give.
