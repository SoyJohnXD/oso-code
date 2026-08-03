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

This host exposes no foreground flag on a launch. Use Codex's wait operation, then the receipt protocol in `subagents.md`: its `--timeout 10` is the common bound, and `handoff consume` is the one-shot precondition for reading that message's verdict. A timeout or identity mismatch blocks this launch; it never falls through to the next step.

## The explorer

Use Codex's built-in `explorer` role for §2 step 1. It inherits the parent Plan Mode's read-only permission, so it can map the surface without becoming an eighth oso-code role. Launch up to three with disjoint evidence targets from the intent, exactly as the neutral body requires.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `../_shared/<file>.md` here, resolved against the directory holding the `SKILL.md` you were routed through — the resolution rule Codex states for every relative path a skill writes. Expand it to an absolute path before putting it in a payload another context reads: the applier and the verifier open the rubric themselves and a relative path means nothing where they run.

## The state command

`OSO_STATE_BIN` reaches every tool subprocess on this host through the installer's `shell_environment_policy.set` entry, so `oso-state` is spelled `"${OSO_STATE_BIN:-oso-state}"` here.

What the state is keyed by is settled and is host-neutral: the state file is the REPOSITORY's (ADR-0095), resolved from the directory the command runs in, so nothing about the identity waits on this host.

**PLACEHOLDER — what fills `--session` here does not.** That flag is what the audit trail records each line under and what a teardown reads back, and this host exposes no session-id variable to fill it; the installer slice that wires `OSO_AGENT` through `shell_environment_policy.set` is what settles the value. Until it lands, do NOT improvise one and do NOT run the state command with the session argument dropped — `oso-state` refuses a write with no session, and a write that never ran reads exactly like a gate that is open.

## The runtime gates, and the two layers of the commit rail

**PLACEHOLDER — the gates are unported and the installer slice settles them.** A Codex plugin cannot bundle hooks, so nothing this package installs can deny a commit or an edit here; the hooks this host does have are user-level and are the installer's business, not this file's. The read side is ready for them — the state is keyed by the repository, and the git `pre-commit` hook arms on `OSO_AGENT` where no `CLAUDE_CODE_SESSION_ID` exists — but nothing on this host sets that variable or wires that hook yet. Until that slice lands, the state writes the neutral body instructs are an AUDIT TRAIL and nothing more: they record where the flow stands, they gate nothing, and no green they write may be reported to the operator as a gate having passed. §6's green window has nothing to open — a rail that is not there is not a rail you widen — so run those three commands as the neutral body's own bookkeeping and tell the operator once, at §5, that the gates are unported on this host.

## The worktree root

**PLACEHOLDER — the runtime-gating slice settles this too.** `<worktree root>` on the Claude side is keyed by the session id, and this host has none; the same slice that settles the state identity settles where worktrees live and what the teardown looks for. Until it lands, PARALLEL execution is unavailable here: §4 offers only SEQUENTIAL, and a worktree cut under an improvised path is a worktree no teardown ever finds.

## Naming and invoking the harness's own skills

The neutral body names each one by role. Non-forked skills are bare names under a flat skills root — no plugin prefix — and there is no skill tool to call: open and read their `SKILL.md` in this context.

| The body says | Here it is | Reached by |
| --- | --- | --- |
| the QUICK mode | `quick` | the operator invokes it — a mode is never model-invoked |
| the DEBUG mode | `debug` | the operator invokes it — a mode is never model-invoked |

Forked judges and operational agents are the exception to inline reading. READ `subagents.md` beside this file NOW and use its seven-role map, payload rules and completion handshake as binding.

**PLACEHOLDER — the absence policy the neutral body points at is spelled for Claude Code.** The Impeccable skill is a Claude Code plugin with no counterpart installed here, and the policy in `_shared/front-surface.md` answers that absence with a two-step `/plugin` install this host has no command for. Slice S8 writes the Codex spelling of that policy — until it lands, tell the operator a front surface runs without the design bar and that no Codex install route is written yet, and let them decide how to proceed, rather than reading the Claude-spelled remedy back to them. The design-foundation slice of §4 does not apply either way.
