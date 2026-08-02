# Debug mode — Codex

## The delivery contract

No swallow is known on this host, and this port has not probed for one. So the discipline stands unchanged rather than relaxed: operator-facing content — the triage report, the diagnosis presentation — ENDS the turn as plain text, with any tool call in a LATER turn. An extra turn is the cheap side of that bet; content the operator never sees is the expensive one.

## Making a launch wait

**PLACEHOLDER — slice S6 settles this.** This host exposes no foreground flag on a launch, so the `run_in_background: false` the Claude side passes has no counterpart to fill. S6's file handshake is what makes a launch wait here. Until it lands, do NOT launch a delegate and read on: an unwaited launch sends §4 step 2 to verify a fix nobody wrote yet, which is the exact failure the neutral body's wait rule exists to prevent.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `../_shared/<file>.md` here, resolved against the directory holding the `SKILL.md` you were routed through — the resolution rule Codex states for every relative path a skill writes. Expand it to an absolute path before putting it in a payload another context reads.

## The state command

`OSO_STATE_BIN` reaches every tool subprocess on this host through the installer's `shell_environment_policy.set` entry, so `oso-state` is spelled `"${OSO_STATE_BIN:-oso-state}"` here.

**PLACEHOLDER — what keys the state, and the gates that read it, are not settled by this slice.** This host exposes no session-id variable, so the `--session` flag the Claude side passes has no counterpart to fill, and a Codex plugin cannot bundle the hooks that read the result. The runtime-gating slice of this port settles both. Until it lands, do NOT improvise a flag and do NOT run the state command with the session argument dropped — a write that lands in nobody's state reads exactly like a gate that is open. Tell the operator the gate is unported and continue the flow without it.

## Naming and invoking the harness's own skills

The neutral body names each one by role. Here they are bare skill names under a flat skills root — no plugin prefix — and there is no skill tool to call: you reach a skill by opening and reading its `SKILL.md` yourself, and you never delegate that reading to a subagent.

| The body says | Here it is | Reached by |
| --- | --- | --- |
| the PLAN mode | `plan` | the operator invokes it — a mode is never model-invoked |
| the quality-pass judge | `quality-pass` | read `skills/quality-pass/SKILL.md` and run it inline, the way it runs on every host |

**PLACEHOLDER — the forked judges and the agents have no skill-level route here.** The debt-sweep judge, the security-pass judge and the `oso-applier` / `oso-verifier` agents all run in a fresh, isolated context on the Claude side, and reading a `SKILL.md` inline does not give you one. Codex runs them as subagents, and the slice of this port that writes the Codex agent role files is what wires them — until it lands, tell the operator the delegated fix, the verification and the two optional judges are unported and let them decide how to proceed, rather than running any of them in this context. §4's whole point is that you never write the fix inline, and a verifier that grades its own author's work is the failure every one of those files exists to prevent.

**PLACEHOLDER — the absence policy the neutral body points at is spelled for Claude Code.** The Impeccable skill is a Claude Code plugin with no counterpart installed here, and the policy in `_shared/front-surface.md` answers that absence with a two-step `/plugin` install this host has no command for. Slice S8 writes the Codex spelling of that policy — until it lands, tell the operator a front surface runs without the design bar and that no Codex install route is written yet, and let them decide how to proceed, rather than reading the Claude-spelled remedy back to them.
