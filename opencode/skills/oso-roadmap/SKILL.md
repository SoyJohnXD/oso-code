---
name: oso-roadmap
description: "Auto mode for a queue of changes. Plans the whole queue with the operator — the children in order, the decisions that hold across all of them, and the policy that answers what surfaces later — takes one approval for the lot, then plans, executes and closes each child, sets aside any child that hits a decision only the operator can take, and chains the next. Use when several substantial changes are known up front and the operator wants to decide once."
argument-hint: "[roadmap name or the changes to queue]"
disable-model-invocation: true
---

# Roadmap mode

Host precondition: this operator-only skill starts only when the operator
invokes `/oso-roadmap`. The installed `opencode.json` denies it to the model
(`permission.skill: {"oso-roadmap": "deny"}`), so the model never sees it and a
model call to the `skill` tool for it is rejected; never imitate the invocation
by printing the command. This instruction is the fallback before that config
has been written by the installer.

This mode's instructions live in two files. READ BOTH NOW, in this order, and follow them as binding — as if their text stood here. Both paths resolve against the directory holding this file:

1. `../_shared/bodies/roadmap.md` — the flow itself: the queue, the autonomy policy, the single approval, the chain, the presence phase. It is the same on every host this harness runs on.
2. `references/opencode.md` — what the flow leaves to the host: the agent every phase runs on, how far the chain runs unattended, the approval gate its one approval crosses, the paths it resolves, and the state command every runtime write of the chain runs under, which that file routes to plan's own reference file rather than spelling twice.

Where the neutral body defers to "your host", the platform file is the answer, and it is the only answer — never improvise a spelling the platform file does not give.
