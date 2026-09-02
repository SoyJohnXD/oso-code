# Doubt pass

This judge's instructions live in one file, and it is binding. READ IT NOW and follow it as if its text stood here; the path resolves against the directory holding this file:

- `../_shared/bodies/doubt-pass.md` — the judgment itself: the input contract, the attack, the verdict vocabulary. It is the same on every host this harness runs on.

This judge leaves nothing to the host — it names no tool and resolves no path — so there is no platform file beside it.

It runs with FRESH EYES as the `oso-doubt-pass` custom role, in a context that never made the decisions it attacks. The caller passes this wrapper's absolute path as `SKILL PATH` and the intent, surface map, and bare decisions as `ARGUMENTS`; the reviewer reads this file and its binding above for itself.
