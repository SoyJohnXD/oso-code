# Quick mode — Codex

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `../_shared/<file>.md` here, resolved against the directory holding the `SKILL.md` you were routed through — the resolution rule Codex states for every relative path a skill writes. Expand it to an absolute path before putting it in a payload another context reads.

## The state command

`OSO_STATE_BIN` reaches every tool subprocess on this host through the installer's `shell_environment_policy.set` entry, so `oso-state` is spelled `"${OSO_STATE_BIN:-oso-state}"` here.

**PLACEHOLDER — what keys the state, and the gates that read it, are not settled by this slice.** This host exposes no session-id variable, so the `--session` flag the Claude side passes has no counterpart to fill, and the runtime-gating slice of this port is what settles both: the identity the state file is keyed by, and how the commit gate is armed on a host whose plugins cannot bundle hooks. Until that slice lands, do NOT improvise a flag and do NOT run the state command with the session argument dropped — a write that lands in nobody's state reads exactly like a gate that is open. Tell the operator the gate is unported and continue the flow without it.

## Naming and invoking the harness's own skills

The neutral body names each one by role. Here they are bare skill names under a flat skills root — no plugin prefix — and there is no skill tool to call: you reach a skill by opening and reading its `SKILL.md` yourself, and you never delegate that reading to a subagent.

| The body says | Here it is | Reached by |
| --- | --- | --- |
| the PLAN mode | `plan` | the operator invokes it — a mode is never model-invoked |
| the DEBUG mode | `debug` | the operator invokes it — a mode is never model-invoked |
| the quality-pass judge | `quality-pass` | read `skills/quality-pass/SKILL.md` and run it inline, the way it runs on every host |

**PLACEHOLDER — the forked judges and the agents have no skill-level route here.** The security-pass judge and the `oso-applier` agent both run in a fresh, isolated context on the Claude side, and reading a `SKILL.md` inline does not give you one. Codex runs them as subagents, and the slice of this port that writes the Codex agent role files is what wires them — until it lands, tell the operator the security review and the delegated fix are unported and let them decide whether to proceed without them, rather than running either one in this context. A judge that reviews its own author's work is the one thing every one of those files exists to prevent.

**PLACEHOLDER — the absence policy the neutral body points at is spelled for Claude Code.** The Impeccable skill is a Claude Code plugin with no counterpart installed here, and the policy in `_shared/front-surface.md` answers that absence with a two-step `/plugin` install this host has no command for. Slice S8 writes the Codex spelling of that policy — until it lands, tell the operator a front surface runs without the design bar and that no Codex install route is written yet, and let them decide how to proceed, rather than reading the Claude-spelled remedy back to them.
