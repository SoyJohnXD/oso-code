# Security pass

This judge's instructions live in two files. READ BOTH NOW, in this order, and follow them as binding — as if their text stood here. Both paths resolve against the directory holding this file:

1. `../_shared/bodies/security-pass.md` — the judgment itself: the two paths, the fallback acquisition, the fallback criteria, the report shape, the verdict vocabulary. It is the same on every host this harness runs on.
2. `../_shared/platform/codex/security-pass.md` — what the judgment leaves to the host: which reviewer is native here, and how this context reaches it.

Where the neutral body defers to "your host", the platform file is the answer, and it is the only answer — never improvise a spelling the platform file does not give.

This judge runs with FRESH EYES as the `oso-security-reviewer` custom role, in a context that never wrote the code it reviews. The caller passes this wrapper's absolute path as `SKILL PATH` and the optional base ref as `ARGUMENTS` (exactly `none` when absent); the reviewer reads this file and both bindings above for itself, then runs the Codex native route inside that same subagent.
