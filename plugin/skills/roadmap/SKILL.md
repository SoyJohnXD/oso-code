---
name: roadmap
description: Auto mode for a queue of changes. Plans the whole queue with the operator — the children in order, the decisions that hold across all of them, and the policy that answers what surfaces later — takes one approval for the lot, then plans, executes and closes each child and chains the next. Use when several substantial changes are known up front and the operator wants to decide once.
argument-hint: [roadmap name or the changes to queue]
disable-model-invocation: true
---

# Roadmap mode

This mode's instructions live in two files. READ BOTH NOW, in this order, and follow them as binding — as if their text stood here:

1. `${CLAUDE_SKILL_DIR}/../_shared/bodies/roadmap.md` — the flow itself: the queue, the autonomy policy, the single approval, the chain, the presence phase. It is the same on every host this harness runs on.
2. `${CLAUDE_SKILL_DIR}/../_shared/platform/claude/roadmap.md` — what the flow leaves to the host: how far the chain runs unattended, the paths it interpolates, the delivery rule this TUI imposes.

Where the neutral body defers to "your host", the platform file is the answer, and it is the only answer — never improvise a spelling the platform file does not give.
