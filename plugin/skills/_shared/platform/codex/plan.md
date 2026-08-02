# Plan mode — Codex

## The delivery contract

No swallow is known on this host, and this port has not probed for one. So the discipline stands unchanged rather than relaxed: operator-facing content ENDS the turn as plain text, with any tool call in a LATER turn. An extra turn is the cheap side of that bet; content the operator never sees is the expensive one.

## Question rounds

The tool is `request_user_input`, and it exists ONLY inside Plan Mode on this host — which is where phases 1–5 already run, and is why they may not leave it early.

**PLACEHOLDER — the per-round cap is not settled by this slice.** The Claude side's 4 is a platform cap, not a harness rule, so it does not transfer by default. Until the slice that probes this host's cap lands, hold to 4 questions per round: it is the number every downstream rule in the neutral body was written against, and a round that turns out to exceed this host's real limit fails loudly at the call rather than quietly under-asking.

## The approval gate

Phases 1–5 run inside this host's native Plan Mode, which has no callable exit — there is no `ExitPlanMode` counterpart to hand a document to.

**PLACEHOLDER — slice S7 settles the approval token.** The gate is the plan document §5 builds, delivered as plain text, plus an explicit literal approval token the operator types back. S7 fixes that token's exact wording; until it lands, do NOT invent one and do NOT treat any free-form agreement as approval — an approval gate that accepts "ok" is the gate this harness does not have. Say the token is unported, and let the operator decide whether to proceed without a gate.

## Making a launch wait

**PLACEHOLDER — slice S6 settles this.** This host exposes no foreground flag on a launch, so the `run_in_background: false` the Claude side passes has no counterpart to fill. S6's file handshake is what makes a launch wait here. Until it lands, do NOT launch a delegate and read on: an unwaited applier sends §6 step 3 to verify code nobody wrote yet, and an unwaited verifier lets step 4 write `verify_green=true` over a verdict nobody read.

## The explorer

**PLACEHOLDER — the Codex subagents are a later slice.** There is no built-in explorer to name here; §2 step 1's parallel exploration is a subagent shape, and the slice of this port that writes the Codex agent role files is what supplies it. Until it lands, do the exploration yourself in this context and say so: a surface map built from one reader's evidence is worse than three, and it is still a map built from evidence, which is what §2's bar actually asks for.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `../_shared/<file>.md` here, resolved against the directory holding the `SKILL.md` you were routed through — the resolution rule Codex states for every relative path a skill writes. Expand it to an absolute path before putting it in a payload another context reads: the applier and the verifier open the rubric themselves and a relative path means nothing where they run.

## The state command

`OSO_STATE_BIN` reaches every tool subprocess on this host through the installer's `shell_environment_policy.set` entry, so `oso-state` is spelled `"${OSO_STATE_BIN:-oso-state}"` here.

**PLACEHOLDER — what keys the state is not settled by this slice.** This host exposes no session-id variable, so the `--session` flag the Claude side passes has no counterpart to fill; the runtime-gating slice of this port settles what replaces it. Until it lands, do NOT improvise a flag and do NOT run the state command with the session argument dropped — a write that lands in nobody's state reads exactly like a gate that is open.

## The runtime gates, and the two layers of the commit rail

**PLACEHOLDER — the gates are unported and the runtime-gating slice settles them.** A Codex plugin cannot bundle hooks, so nothing this package installs can deny a commit or an edit here; the hooks this host does have are user-level and are the installer's business, not this file's. Until that slice lands, the state writes the neutral body instructs are an AUDIT TRAIL and nothing more: they record where the flow stands, they gate nothing, and no green they write may be reported to the operator as a gate having passed. §6's green window has nothing to open — a rail that is not there is not a rail you widen — so run those three commands as the neutral body's own bookkeeping and tell the operator once, at §5, that the gates are unported on this host.

## The worktree root

**PLACEHOLDER — the runtime-gating slice settles this too.** `<worktree root>` on the Claude side is keyed by the session id, and this host has none; the same slice that settles the state identity settles where worktrees live and what the teardown looks for. Until it lands, PARALLEL execution is unavailable here: §4 offers only SEQUENTIAL, and a worktree cut under an improvised path is a worktree no teardown ever finds.

## Naming and invoking the harness's own skills

The neutral body names each one by role. Here they are bare skill names under a flat skills root — no plugin prefix — and there is no skill tool to call: you reach a skill by opening and reading its `SKILL.md` yourself, and you never delegate that reading to a subagent.

| The body says | Here it is | Reached by |
| --- | --- | --- |
| the QUICK mode | `quick` | the operator invokes it — a mode is never model-invoked |
| the DEBUG mode | `debug` | the operator invokes it — a mode is never model-invoked |

**PLACEHOLDER — the forked judges and the agents have no skill-level route here.** The doubt-pass, debt-sweep, triage and security-pass judges and the `oso-applier`, `oso-verifier` and `oso-integrator` agents all run in a fresh, isolated context on the Claude side, and reading a `SKILL.md` inline does not give you one. Codex runs them as subagents, and the slice of this port that writes the Codex agent role files is what wires them — until it lands, tell the operator which of them the flow is about to need and let them decide how to proceed, rather than running any of them in this context. §6's whole premise is that the orchestrator never writes the code it plans, and a judge that grades its own author's work is the failure every one of those files exists to prevent.

**PLACEHOLDER — the absence policy the neutral body points at is spelled for Claude Code.** The Impeccable skill is a Claude Code plugin with no counterpart installed here, and the policy in `_shared/front-surface.md` answers that absence with a two-step `/plugin` install this host has no command for. Slice S8 writes the Codex spelling of that policy — until it lands, tell the operator a front surface runs without the design bar and that no Codex install route is written yet, and let them decide how to proceed, rather than reading the Claude-spelled remedy back to them. The design-foundation slice of §4 does not apply either way.
