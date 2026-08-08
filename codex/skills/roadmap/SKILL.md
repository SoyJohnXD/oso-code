---
name: roadmap
description: "Auto mode for a queue of changes. Plans the whole queue with the operator — the children in order, the decisions that hold across all of them, and the policy that answers what surfaces later — takes one approval for the lot, then plans, executes and closes each child and chains the next. Use when several substantial changes are known up front and the operator wants to decide once."
argument-hint: "[roadmap name or the changes to queue]"
disable-model-invocation: true
---

# Roadmap mode

Host precondition: this operator-only skill starts only when Codex's active
collaboration mode is `Plan`, because §1 plans the queue with the operator
through `request_user_input`, which this host exposes only there. If it is not,
stop immediately and tell the operator to enter `/plan` (or use Shift+Tab), then
invoke `$oso-code:roadmap` again. Never imitate the transition by printing
`/plan`, and do not begin §1 in Default mode. No installed hook gates this
invocation: `UserPromptSubmit` refuses `$oso-code:plan` outside Plan Mode and no
other skill invocation, so this instruction is the whole of that boundary.

This mode's instructions live in two files. READ BOTH NOW, in this order, and follow them as binding — as if their text stood here. Both paths resolve against the directory holding this file:

1. `../_shared/bodies/roadmap.md` — the flow itself: the queue, the autonomy policy, the single approval, the chain, the presence phase. It is the same on every host this harness runs on.
2. `../_shared/platform/codex/roadmap.md` — what the flow leaves to the host: how far the chain runs unattended, the paths it resolves, and where each child still waits for the operator.

Where the neutral body defers to "your host", the platform file is the answer, and it is the only answer.
