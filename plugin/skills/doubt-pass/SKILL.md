---
name: doubt-pass
description: Fresh-context adversarial reviewer of a decision-ledger candidate. Launched by the /plan orchestrator pre-freeze on irreversible-blast-radius triggers (migrations, security, or rollback surfaces); also invocable when the operator asks to stress a decision set. Reads only the intent, surface map, and bare decisions — never the author's rationale — and reports what is wrong, missing, or unconsidered. It judges only — never edits, never saves, never asks back.
argument-hint: [intent + surface map + bare decisions]
context: fork
agent: general-purpose
background: false
model: opus
---

# Doubt pass

This judge's instructions live in one file, and it is binding. READ IT NOW and follow it as if its text stood here:

- `${CLAUDE_SKILL_DIR}/../_shared/bodies/doubt-pass.md` — the judgment itself: the input contract, the attack, the verdict vocabulary. It is the same on every host this harness runs on.

This judge leaves nothing to the host — it names no tool and interpolates no path — so there is no platform file beside it.
