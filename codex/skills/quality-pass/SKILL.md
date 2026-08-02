---
name: quality-pass
description: "Readability-only cleanup of touched code after functionality is confirmed. Verifies against the clean-code checklist, fixes what fails, and re-verifies — never changes behavior. Use when a change is functionally done, when the user asks for cleanup or a quality pass, or as the closing step of quick and debug modes."
---

# Quality pass

This pass's instructions live in two files. READ BOTH NOW, in this order, and follow them as binding — as if their text stood here. Both paths resolve against the directory holding this file:

1. `../_shared/bodies/quality-pass.md` — the pass itself: the contract, verify, apply, re-verify, and the verdict vocabulary. It is the same on every host this harness runs on.
2. `../_shared/platform/codex/quality-pass.md` — what the pass leaves to the host: the paths it resolves.

Where the neutral body defers to "your host", the platform file is the answer, and it is the only answer — never improvise a spelling the platform file does not give.
