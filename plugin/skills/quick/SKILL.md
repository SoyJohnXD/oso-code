---
name: quick
description: Fast iteration mode for small, easily verifiable changes. Runs a one-exchange micro-intent, iterates with visible results, and closes with a quality pass. Use for visual tweaks, small fixes, and adjustments that fit in a handful of files.
argument-hint: [what to change]
disable-model-invocation: true
---

# Quick mode

This mode's instructions live in two files. READ BOTH NOW, in this order, and follow them as binding — as if their text stood here:

1. `${CLAUDE_SKILL_DIR}/../_shared/bodies/quick.md` — the flow itself: the micro-intent, the substantiality check, the iteration rules, the close. It is the same on every host this harness runs on.
2. `${CLAUDE_SKILL_DIR}/../_shared/platform/claude/quick.md` — what the flow leaves to the host: the tools it calls, the paths it interpolates, the state command the gates read.

Where the neutral body defers to "your host", the platform file is the answer, and it is the only answer — never improvise a spelling the platform file does not give.
