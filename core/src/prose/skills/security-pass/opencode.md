# Security pass

The flow that follows this preface is the same on every host this harness runs on. It opens by pointing you at `references/opencode.md` — what it leaves to this host: which reviewer is native here, and how this context reaches it.

This judge runs with FRESH EYES as the `oso-security-reviewer` agent, in a context that never wrote the code it reviews. The caller passes this wrapper's absolute path as `SKILL PATH` and the optional base ref as `ARGUMENTS` (exactly `none` when absent); the reviewer reads this file and its reference-file binding for itself, then runs the review path inside that same agent.
