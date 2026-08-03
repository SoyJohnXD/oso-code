# Plan mode — Codex

## The delivery contract

No swallow is known on this host, and this port has not probed for one. So the discipline stands unchanged rather than relaxed: operator-facing content ENDS the turn as plain text, with any tool call in a LATER turn. An extra turn is the cheap side of that bet; content the operator never sees is the expensive one.

## Question rounds

The tool is `request_user_input`, and it exists ONLY inside Plan Mode on this host — which is where phases 1–5 already run, and is why they may not leave it early.

**PLACEHOLDER — the per-round cap is not settled by this slice.** The Claude side's 4 is a platform cap, not a harness rule, so it does not transfer by default. Until the slice that probes this host's cap lands, hold to 4 questions per round: it is the number every downstream rule in the neutral body was written against, and a round that turns out to exceed this host's real limit fails loudly at the call rather than quietly under-asking.

## The approval gate

Phases 1–5 run inside this host's native Plan Mode, which has no callable exit — there is no `ExitPlanMode` counterpart to hand a document to.

Before delivery, finish every unified-exec process this flow started; never carry a live session across the approval boundary. `write_stdin` is transport for an existing process and does not run `PreToolUse` again, so an open process would be a path the pending gate cannot observe. A process launched inside Plan Mode retains that launch's read-only sandbox, but the rail does not rely on that as cleanup.

Deliver the complete §5 document as a turn-ending plain-text response: repaso first, full detail after it. End it with the operator instruction to toggle Plan Mode off and then send a new message containing only `APPROVE OSO PLAN`. The exact final line after that instruction is the internal transport marker `oso-plan-approval: v=1 token=APPROVE_OSO_PLAN`; emit it once, never inside a fence and with no trailing newline.

The host-side `Stop` hook observes that marker while `permission_mode` is `plan`, hashes the wire-exact `last_assistant_message` field and atomically records `plan_approval=pending` beside its digest and session. That pending state closes the catch-all `PreToolUse` gate for every new local function-tool call. It is a precondition, not approval and not a semantic verdict about the plan.

The match is case-sensitive and byte-exact. Approval occurs only when `APPROVE OSO PLAN` is the whole user prompt, the same session still owns the pending digest, and `permission_mode` is one of this host's documented non-Plan modes. Punctuation, whitespace, a code fence, surrounding text, a free-form "ok" or "yes", and the exact token received while the host still reports Plan Mode are not approval. `UserPromptSubmit` blocks an invalid token before the model sees it and atomically changes the matching pending digest to `plan_approval=approved` before the accepted turn begins. Until then, do not save plan state, arm a slice or call an implementation tool.

Feedback is not approval. When an ordinary reply arrives after the operator has returned to Plan Mode, `UserPromptSubmit` atomically invalidates that same session's pending digest before the turn, reopening Plan Mode's read-only tools so the document can be revised and re-presented. Ordinary feedback in a non-Plan mode leaves the pending deny closed and must route the operator back to Plan Mode. To abandon instead, the operator sends the whole byte-exact prompt `CANCEL OSO PLAN` in either Plan or non-Plan mode. `UserPromptSubmit` atomically cancels only the same session's pending digest and removes its state; this host-side token is the Codex spelling of the neutral body's otherwise blocked `oso-state clear`, not a second approval gate. Never approve merely to gain a tool call that clears state.

A material change to the document invalidates prior approval under §5: re-present the complete repaso-first plan with the marker, so `Stop` replaces the old digest with a fresh pending one, then cross the token gate again. Never reuse an earlier token after changing the plan.

This is mechanical enforcement for local tools, not Codex's native approval UI. Current `PreToolUse` covers new shell, `apply_patch`, MCP and other local function-tool calls, but not hosted tools; specialized paths may opt out, and `write_stdin` does not re-check an existing unified-exec process. Oso closes every such process before presenting the plan and routes no execution write through hosted tools. If Codex adds another unhooked writer, record a parity regression and keep it outside execution until a hookable boundary exists.

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

## Front-surface binding

When `../../front-surface.md`'s trigger fires, READ `front-surface.md` beside this file NOW. It is the single Codex binding for Impeccable's mounted path, all three argument routes, package-version record, agent route and absence remedy; this mode supplies only the PLAN wiring indexed by the neutral matrix.
