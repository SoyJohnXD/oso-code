# Plan mode — Codex

## The delivery contract

The adapter makes no claim about whether Codex preserves operator-facing text before a same-turn tool call, and the harness depends on no such behavior. It applies the conservative host-independent policy: operator-facing content ENDS the turn as plain text, with any tool call in a LATER turn. An extra turn is the cheap side of that boundary; content the operator never sees is the expensive one.

## Question rounds

The tool is `request_user_input`, and it exists ONLY inside Plan Mode on this host — which is where phases 1–5 already run, and is why they may not leave it early. Its schema accepts a maximum of 3 questions in one call, so a Codex decision round holds 3 per round (ADR-0097). A fourth question starts the next round; it never rides an invalid call and never gets dropped.

## The approval gate

Phases 1–5 run inside this host's native Plan Mode, which has no callable exit — there is no `ExitPlanMode` counterpart to hand a document to.

`$oso-code:plan` is not a mode transition. The operator enters native Plan Mode with `/plan` or Shift+Tab before invoking the skill. The installed `UserPromptSubmit` hook rejects an invocation whose prompt begins with `$oso-code:plan` unless the exact hook turn attests native Plan Mode; Codex 0.146 misreports its approval policy as `permission_mode=default` in Plan Mode, so the compatibility resolver binds `transcript_path` plus `turn_id` to the host-generated `task_started.collaboration_mode_kind` event and falls back to the documented field when that event is unavailable. The Codex wrapper repeats the preflight before phase 0 so an untrusted hook cannot turn Default mode into a plan-looking but unenforceable run. Never claim to enter Plan Mode, print `/plan` as though it executed, or continue past that refusal.

Before delivery, finish every unified-exec process this flow started; never carry a live session across the approval boundary. `write_stdin` is transport for an existing process and does not run `PreToolUse` again, so an open process would be a path the pending gate cannot observe. A process launched inside Plan Mode retains that launch's read-only sandbox, but the rail does not rely on that as cleanup.

Deliver the complete §5 document as a turn-ending plain-text response: repaso first, full detail after it. Do not add a second approval instruction or ask the operator to type a harness token: Codex's native plan approval control owns the visible transition and submits `Implement the plan.` on the verified client. The exact final LOGICAL line of the response is the hidden transport comment `<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->`; emit it once, never inside a fence, and never author content after it. Codex Stop may serialize either no suffix or exactly one host-owned terminal LF; the hook accepts both terminal representations under ADR-0104 while hashing the exact raw field, and rejects a second LF, CR, spaces or text after the marker.

The host-side `Stop` hook observes that marker only after the same exact-turn resolver attests native Plan Mode. When `last_assistant_message` still contains the full document, it hashes that wire-exact field and persists the decoded plan without the internal marker. When Codex's native `<proposed_plan>` renderer splits the visible plan into a host-generated `item_completed` item and leaves `last_assistant_message` marker-only, the hook requires exactly one same-session, same-turn transcript item with `item.type=Plan`, hashes that exact Plan-item text plus the marker, and persists the Plan-item text as the operational artifact. Missing, foreign, duplicate, empty or marker-bearing Plan items fail closed. In the same state transition it records `plan_approval=pending` beside the digest and session under `~/.local/state/oso-code/plans/<repository digest>/`: `presented-<approval digest>.md` is the pending snapshot and `current.md` is the operational copy. That pending state closes the catch-all `PreToolUse` gate for every new local function-tool call. It is a precondition, not approval and not a semantic verdict about the plan.

A malformed-marker rejection is a diagnostic boundary, not a retry instruction. Never print the same approval document unchanged after that rejection: either identify and correct a concrete marker-shape defect, or report the failed capture without the marker and stop so the operator can restart planning. This prevents a host-shape mismatch from duplicating the full plan while producing the same failure again (ADR-0104).

The native match is case-sensitive and byte-exact. Approval occurs only when `Implement the plan.` is the whole user prompt, the same session still owns the pending digest, and the exact approval turn attests a non-Plan collaboration mode. Under the same compare-and-set lock, `UserPromptSubmit` promotes the immutable snapshot to `approved-<approval digest>.md`, publishes `plan_approval=approved`, and leaves `current.md` as the mutable execution document before the accepted turn begins. Without a pending Oso digest, that common Codex phrase is ordinary conversation and the hook returns no verdict. Punctuation changes, whitespace, a code fence, surrounding text, a free-form "ok" or "yes", and the exact phrase received while the host still reports Plan Mode are not approval. Until native approval lands, do not save Engram plan state, arm a slice or call an implementation tool.

Feedback is not approval. When an ordinary reply arrives after the operator has returned to Plan Mode, `UserPromptSubmit` atomically amends that same session's pending document in place before the turn — `oso-state amend-plan` appends the feedback to `current.md` and bumps `plan_revision`, but never touches the presented snapshot or its digest, so the operator reads and answers the amendment, not the whole plan again. Present what changed and why, then re-emit the marker on the updated document: `capture-plan` is what binds a fresh digest, and until it runs, `approve-plan`'s own content-parity check refuses `Implement the plan.` against a `current.md` that no longer matches what was presented — approval still binds only the exact document the operator saw. Ordinary feedback in a non-Plan mode leaves the pending deny closed and must route the operator back to Plan Mode. To abandon instead, the operator sends the whole byte-exact prompt `CANCEL OSO PLAN` in either Plan or non-Plan mode. `UserPromptSubmit` atomically cancels only the same session's pending digest and removes its state; this host-side token is the Codex spelling of the neutral body's otherwise blocked `oso-state clear`, not a second approval gate. Never approve merely to gain a tool call that clears state.

A material change to the document invalidates prior approval under §5: return to native Plan Mode, re-present the complete repaso-first plan with the marker, and let Codex's native approval control bind the new digest. Never treat an earlier native approval as authority for changed scope or frozen decisions.

### Codex operational plan and hot slices

The immutable `approved-<approval digest>.md` answers what the operator approved; never edit or replace it. `current.md` answers what remains to execute and may change only through a recorded operational amendment. Engram remains the cross-session semantic index, so every accepted amendment updates BOTH `current.md` and the existing `oso/{change}/plan` observation; neither store silently outranks the other.

An explicit operator request may add a hot slice without returning to Plan Mode only when every condition holds: it stays inside the frozen intent and scope; preserves every ledger decision; introduces no new contract, migration, auth/security/rollback surface, dependency policy, base ref or execution-mode decision; carries Goal, Files, Verify and Depends-on; and does not rewrite an active or completed slice. The operator's request is the amendment authorization. Append the slice after the active sequential slice or after the current parallel wave — never inject work into a unit already in flight — then pipe the complete slice block to `"${OSO_STATE_BIN:-oso-state}" --session "${OSO_AGENT}" amend-plan <slice-id>`, read `oso-state show` back, and `mem_update` the plan topic with the same pending slice and position. The state command appends a dated in-scope amendment to `current.md`, increments `plan_revision`, records the event and returns `verify_green=false`; it never edits the immutable snapshot.

If any condition fails, the request is material. Recommend saving it as a new `roadmap` row in Engram and finish the active change unchanged. If the operator requires it for the active outcome, return to native Plan Mode and pass a fresh approval instead; approval has no meaning if architecture or scope can expand later through an ordinary execution prompt.

**A harness-discovered correction to a not-started slice may also amend `current.md` through one operator confirmation, never a full re-approval, when every condition holds (ADR-0117):** the target slice has NOT STARTED — never armed as `active_slice` and carrying no `[x]` in the Engram plan; a slice already active or completed takes the material-change route above instead, unchanged. The correction CITES the evidence that disproves the slice's premise — the file and line of the installed artifact its premise contradicts; an uncited correction is the harness rewriting an approved slice on its own assertion, so it is never eligible here. Present the citation and the corrected fact to the operator, who CONFIRMS in one line — not a re-read of the plan; that confirmation, never the harness's own finding, is what authorizes the amendment, exactly as the operator's own request authorizes a hot slice above. On confirmation, pipe the citation, what changes, and the corrected slice fields to `"${OSO_STATE_BIN:-oso-state}" --session "${OSO_AGENT}" amend-plan <slice-id>`, read `oso-state show` back, and `mem_update` the plan topic and the ledger with the same correction — the identical mechanics the hot-slice paragraph above already relies on, so the amendment and its event RECORD the same way. Any single condition missing routes to the material-change rule instead, never this lane.

This composes Codex's native approval UI with Oso's local digest and artifact rail; it does not widen hook coverage. Current `PreToolUse` covers new shell, `apply_patch`, MCP and other local function-tool calls, but not hosted tools; specialized paths may opt out, and `write_stdin` does not re-check an existing unified-exec process. Oso closes every such process before presenting the plan and routes no execution write through hosted tools. If Codex adds another unhooked writer, record a parity regression and keep it outside execution until a hookable boundary exists.

## Making a launch wait

This host exposes no foreground flag on a launch. Use Codex's wait operation, then the receipt protocol in `../_shared/references/codex.md`'s **Completion handshake** section: its `--timeout 10` is the common bound, and `handoff consume` is the one-shot precondition for reading that message's verdict. A timeout or identity mismatch blocks this launch; it never falls through to the next step.

## The explorer

Use Codex's built-in `explorer` role for §2 step 1. It inherits the parent Plan Mode's read-only permission, so it can map the surface without becoming an eighth oso-code role. Launch up to three with disjoint evidence targets from the intent, exactly as the neutral body requires.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `../_shared/<file>.md` here, resolved against the directory holding the `SKILL.md` you were routed through — the resolution rule Codex states for every relative path a skill writes. Expand it to an absolute path before putting it in a payload another context reads: the applier and the verifier open the rubric themselves and a relative path means nothing where they run.

## The state command

`OSO_STATE_BIN` reaches every tool subprocess on this host through the installer's `shell_environment_policy.set` entry, so `oso-state` is spelled `"${OSO_STATE_BIN:-oso-state}"` here.

What the state is keyed by is settled and is host-neutral: the state file is the REPOSITORY's (ADR-0095), resolved from the directory the command runs in, so nothing about the identity waits on this host.

This host publishes the fixed marker `OSO_AGENT=1` through `shell_environment_policy.set` for tool subprocesses and as an explicit environment prefix on every installed user-hook command. Spell every state call as `"${OSO_STATE_BIN:-oso-state}" --session "${OSO_AGENT}" <verb> …`. Codex does not expose its hook session id to the model, and runtime state is intentionally shared by repository, so this marker is audit metadata and the common value the `session` key — the OWNERSHIP identity — carries for model-issued state writes, the edit/commit readers, teardown and the git hook; never a claim that Codex supplied a hidden session id. Handoff hooks keep the real payload session where same-session isolation is their contract. Plan approval keeps a second, separate key for the same reason: `plan_approval_session` is written only by `capture-plan` under the real session Stop observed, and `approve-plan`, `cancel-plan` and `amend-plan` compare against it rather than `session`, so a later `session`-overwriting write under the shared marker can never unbind a still-pending approval from the session that presented it (ADR-0107).

## The runtime gates, and the two layers of the commit rail

The installer materializes the release-hashed handlers and rendered user manifest outside the plugin, then wires the repository's git `pre-commit` layer when no other hook owner exists. Codex requires the operator to review and trust user hooks through `/hooks`; until that review is complete, report the rail as installed but not trusted and do not describe it as enforcing. Once trusted, model-issued state, edit/commit readers and teardown use the fixed marker; approval and handoff retain their real payload identity.

## The worktree root

`<worktree root>` is `$HOME/.local/state/oso-code/worktrees/${OSO_AGENT}`. The installer's `oso` permission profile adds the parent worktree directory as a workspace root; every slice still receives its exact absolute worktree path and its ref coordinate (SLICE START or WAVE START). Teardown uses the same marker, so it reaches the directory the orchestrator created.

## Naming and invoking the harness's own skills

Installed plugin skills carry Codex's `oso-code:` namespace. Operator-invoked modes use that full identity; an orchestrator reaches an auxiliary skill by opening and reading its namespaced plugin `SKILL.md` in this context.

| The body says | Here it is | Reached by |
| --- | --- | --- |
| the QUICK mode | `oso-code:quick` | the operator invokes `$oso-code:quick` — a mode is never model-invoked |
| the DEBUG mode | `oso-code:debug` | the operator invokes `$oso-code:debug` — a mode is never model-invoked |

Forked judges and operational agents are the exception to inline reading. READ `../_shared/references/codex.md`'s **Delegated roles** and **Completion handshake** sections NOW and use their seven-role map, payload rules and completion handshake as binding.

## Front-surface binding

When `../_shared/front-surface.md`'s trigger fires, READ `../_shared/references/codex.md`'s **Front-surface binding** section NOW. It is the single Codex binding for Impeccable's mounted path, all three argument routes, package-version record, agent route and absence remedy; this mode supplies only the PLAN wiring indexed by the neutral matrix.

## Reporting binding

READ `../_shared/references/codex.md`'s **No card exists here** section NOW. It is the single Codex binding for what this host's own UI shows, and does not show, when the milestone contract at `../_shared/reporting.md` fires.
