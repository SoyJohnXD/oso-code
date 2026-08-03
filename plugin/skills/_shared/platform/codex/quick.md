# Quick mode — Codex

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `../_shared/<file>.md` here, resolved against the directory holding the `SKILL.md` you were routed through — the resolution rule Codex states for every relative path a skill writes. Expand it to an absolute path before putting it in a payload another context reads.

## The state command

`OSO_STATE_BIN` reaches every tool subprocess on this host through the installer's `shell_environment_policy.set` entry, so `oso-state` is spelled `"${OSO_STATE_BIN:-oso-state}"` here.

What the state is keyed by is settled and is host-neutral: the state file is the REPOSITORY's (ADR-0095), resolved from the directory the command runs in.

**PLACEHOLDER — what fills `--session`, and the gates that read the state, are not.** That flag is what the audit trail records each line under, and this host exposes no session-id variable to fill it; the installer slice that wires `OSO_AGENT` through `shell_environment_policy.set` settles the value, and the gates wait on the same slice because a Codex plugin cannot bundle hooks. Until it lands, do NOT improvise a flag and do NOT run the state command with the session argument dropped — `oso-state` refuses a write with no session, and a write that never ran reads exactly like a gate that is open. Tell the operator the gate is unported and continue the flow without it.

## Naming and invoking the harness's own skills

The neutral body names each one by role. Non-forked skills are bare names under a flat skills root — no plugin prefix — and there is no skill tool to call: open and read their `SKILL.md` in this context.

| The body says | Here it is | Reached by |
| --- | --- | --- |
| the PLAN mode | `plan` | the operator invokes it — a mode is never model-invoked |
| the DEBUG mode | `debug` | the operator invokes it — a mode is never model-invoked |
| the quality-pass judge | `quality-pass` | read `skills/quality-pass/SKILL.md` and run it inline, the way it runs on every host |

Forked judges and operational agents are the exception to inline reading. READ `subagents.md` beside this file NOW and use its role map, payload rules and completion handshake as binding. Quick has no separate wait section, so the common receipt protocol applies directly to every launch whose result the flow consumes.

**PLACEHOLDER — the absence policy the neutral body points at is spelled for Claude Code.** The Impeccable skill is a Claude Code plugin with no counterpart installed here, and the policy in `_shared/front-surface.md` answers that absence with a two-step `/plugin` install this host has no command for. Slice S8 writes the Codex spelling of that policy — until it lands, tell the operator a front surface runs without the design bar and that no Codex install route is written yet, and let them decide how to proceed, rather than reading the Claude-spelled remedy back to them.
