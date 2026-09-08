# Plan mode — Codex

## The delivery contract

Follow the shared host [delivery contract](../_shared/references/codex.md#the-delivery-contract). The complete §5 document remains a turn-ending plain-text response for Codex's native approval rail, whose marker stays the final logical line.

## Question rounds

The tool is `request_user_input`, and it exists ONLY inside Plan Mode on this host — which is where phases 1–5 already run, and is why they may not leave it early. Its schema accepts a maximum of 3 questions in one call, so a Codex decision round holds 3 per round. A fourth question starts the next round; it never rides an invalid call and never gets dropped.

## The approval gate

Phases 1–5 run inside this host's native Plan Mode, which has no callable exit — there is no `ExitPlanMode` counterpart to hand a document to.

`$oso-code:plan` is not a mode transition. The operator enters native Plan Mode with `/plan` or Shift+Tab before invoking the skill. The installed `UserPromptSubmit` hook rejects an invocation whose prompt begins with `$oso-code:plan` unless the exact hook turn attests native Plan Mode; Codex 0.146 misreports its approval policy as `permission_mode=default` in Plan Mode, so the compatibility resolver binds `transcript_path` plus `turn_id` to the host-generated `task_started.collaboration_mode_kind` event and falls back to the documented field when that event is unavailable. The Codex wrapper repeats the preflight before phase 0 so an untrusted hook cannot turn Default mode into a plan-looking but unenforceable run. Never claim to enter Plan Mode, print `/plan` as though it executed, or continue past that refusal.

Before delivery, finish every unified-exec process this flow started; never carry a live session across the approval boundary. `write_stdin` is transport for an existing process and does not run `PreToolUse` again, so an open process would be a path the pending gate cannot observe. A process launched inside Plan Mode retains that launch's read-only sandbox, but the rail does not rely on that as cleanup.

Deliver the complete §5 document as a turn-ending plain-text response: repaso first, full detail after it. Do not add a second approval instruction or ask the operator to type a harness token: Codex's native plan approval control owns the visible transition and submits `Implement the plan.` on the verified client. The exact final LOGICAL line of the response is the hidden transport comment `<!-- oso-plan-approval: v=2 action=IMPLEMENT_THE_PLAN -->`; emit it once, never inside a fence, and never author content after it. Codex Stop may serialize either no suffix or exactly one host-owned terminal LF; the hook accepts both terminal representations while hashing the exact raw field, and rejects a second LF, CR, spaces or text after the marker.

Present the entire document inside one `<proposed_plan>` block, with the internal marker after the closing delimiter. The `Stop` hook attests the exact native session and Plan turn, selects its latest completed final `AgentMessage`, and requires the matching Stop text and same-id raw response. A rendered `Plan` belongs only to the interval before that final and after the preceding final or task boundary. A corrected final in the same turn has a distinct assistant-message id even when Codex reuses the Plan id; it does not make an arbitrary last Plan authoritative. Missing, foreign, duplicate, incomplete, empty or conflicting pairs fail closed. Full-message transport retains its wire digest; split transport hashes the exact rendered Plan text plus the marker. Only the native opening LF is removed when comparing the raw proposed-plan body with the rendered Plan; trailing LF and Unicode remain exact.

Capture records a private version, turn and final-message binding alongside `plan_approval=pending`, digest and session under `~/.local/state/oso-code/plans/<repository digest>/`. The `presented-<approval digest>.md` snapshot and `current.md` operational copy must agree before approval. Failed capture preserves existing documents but cannot authorize the newer request through an older pending or approved artifact. Pending state closes the catch-all `PreToolUse` gate for every new local function-tool call; it is a precondition, not approval or a semantic verdict.

A recoverable authoring rejection names a bounded structural reason, including the affected slice when its Verify requirement is missing. Correct that concrete defect once and present the complete replacement on the active Stop retry. Never repeat the unchanged failure. Repeated failure, storage faults or unprovable identity end the attempt explicitly; do not loop or ask for a new token.

The native match is case-sensitive and byte-exact. Approval occurs only when `Implement the plan.` is the whole user prompt, the same session owns the pending digest, and the exact approval turn attests Default mode. Under the existing compare-and-set lock, the hook validates the latest presentation preceding that approval turn against the private binding and current/snapshot parity before promoting `approved-<approval digest>.md` and publishing `plan_approval=approved`. A newer failed, incomplete or ambiguous presentation cannot resume an older approval. Without outstanding Oso context, the phrase remains ordinary conversation; cancelled or completed history alone does not turn it into a control. Punctuation changes, surrounding text and the phrase received in Plan Mode are not approval. Until native approval lands, do not save Engram plan state, arm a slice or call an implementation tool.

Legacy pending documents without the private native binding never silently approve. The next native Plan interaction automatically supplies the complete preserved document for replacement and fresh capture. If the first interaction is Default approval, explain the compatibility refresh and request only the necessary native Plan transition; hooks cannot switch modes. Do not ask the operator to locate a file, copy a digest or run a capture command. Historical approved snapshots remain provenance.

Feedback is not approval. An ordinary Plan Mode reply amends the same session's pending operational document without changing its immutable snapshot. Present a COMPLETE replacement `<proposed_plan>`, including every unchanged section and the incorporated feedback, followed by the internal marker; never present only a delta. Fresh capture binds the updated document, and current/snapshot parity prevents approval before that replacement. Non-Plan feedback leaves execution closed and routes back to Plan Mode. To abandon, the operator sends the exact prompt `CANCEL OSO PLAN` in either attested mode. The hook cancels only the owning session's outstanding pending document and clears its runtime state. Never approve merely to gain a tool call that clears state.

A material change to the document invalidates prior approval under §5: return to native Plan Mode, re-present the complete repaso-first plan with the marker, and let Codex's native approval control bind the new digest. Never treat an earlier native approval as authority for changed scope or frozen decisions.

### Codex operational plan and hot slices

The immutable `approved-<approval digest>.md` answers what the operator approved; never edit or replace it. `current.md` answers what remains to execute and may change only through a recorded operational amendment. After its durable local readback, publish the dated amendment to the existing `oso/{change}/plan` observation under the shared host's essential-memory contract. Missing persistence remains incomplete recovery; Engram never overrides local authorization.

An explicit operator request may add a hot slice without returning to Plan Mode only when every condition holds: it stays inside the frozen intent and scope; preserves every ledger decision; introduces no new contract, migration, auth/security/rollback surface, dependency policy, base ref or execution-mode decision; carries Goal, Files, Verify and Depends-on; and does not rewrite an active or completed slice. The operator's request is the amendment authorization. Append the slice after the active sequential slice or after the current parallel wave — never inject work into a unit already in flight — then pipe the complete slice block to `"${OSO_STATE_BIN:-oso-state}" --session "${CODEX_THREAD_ID}" amend-plan <slice-id>`, read `oso-state show` back, and `mem_update` the plan topic with the same pending slice and position. The state command appends a dated in-scope amendment to `current.md`, increments `plan_revision`, records the event and returns `verify_green=false`; it never edits the immutable snapshot.

If any condition fails, the request is material. Recommend saving it as a new `roadmap` row in Engram and finish the active change unchanged. If the operator requires it for the active outcome, return to native Plan Mode and pass a fresh approval instead; approval has no meaning if architecture or scope can expand later through an ordinary execution prompt.

**A harness-discovered correction to a not-started slice may also amend `current.md` through one operator confirmation, never a full re-approval, when every condition holds:** the target slice has NOT STARTED — never armed as `active_slice` and carrying no `[x]` in the Engram plan; a slice already active or completed takes the material-change route above instead, unchanged. The correction CITES the evidence that disproves the slice's premise — the file and line of the installed artifact its premise contradicts; an uncited correction is the harness rewriting an approved slice on its own assertion, so it is never eligible here. Present the citation and the corrected fact to the operator, who CONFIRMS in one line — not a re-read of the plan; that confirmation, never the harness's own finding, is what authorizes the amendment, exactly as the operator's own request authorizes a hot slice above. On confirmation, pipe the citation, what changes, and the corrected slice fields to `"${OSO_STATE_BIN:-oso-state}" --session "${CODEX_THREAD_ID}" amend-plan <slice-id>`, read `oso-state show` back, and `mem_update` the plan topic and the ledger with the same correction — the identical mechanics the hot-slice paragraph above already relies on, so the amendment and its event RECORD the same way. Any single condition missing routes to the material-change rule instead, never this lane.

This composes Codex's native approval UI with Oso's local digest and artifact rail; it does not widen hook coverage. Current `PreToolUse` covers new shell, `apply_patch`, MCP and other local function-tool calls, but not hosted tools; specialized paths may opt out, and `write_stdin` does not re-check an existing unified-exec process. Oso closes every such process before presenting the plan and routes no execution write through hosted tools. If Codex adds another unhooked writer, record a parity regression and keep it outside execution until a hookable boundary exists.

## Making a launch wait

This host exposes no foreground flag on a launch. Follow `../_shared/references/codex.md`'s **Completion handshake** and **Correction and quiescence** sections: current native final, exact UUID resolution, successful receipt wait and consume precede verdict interpretation. Their reuse and owned-handle requirements override neutral relaunch defaults without resetting loop caps.

## The wave's readiness route

`../_shared/parallel.md`'s readiness paragraph is opted in HERE for this host: READ `../_shared/references/codex.md`'s **Readiness and freshness** section NOW and follow it for every wave verification, slot reservation and freshness rebinding. That loop's dependency and isolation barriers, batching cap, all-green barrier, serialized green window and integration gate stay exactly as it writes them.

## The explorer

Use Codex's built-in `explorer` role for §2 step 1. It inherits the parent Plan Mode's read-only permission, so it can map the surface without becoming an eighth oso-code role. Launch up to three with disjoint evidence targets from the intent, exactly as the neutral body requires.

## Closure policy

READ `../_shared/references/codex.md`'s **Strict closure** section NOW. It governs this host's debt/scope payloads, independent confirmation, correction freshness and exit policy in place of the neutral defaults.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `../_shared/<file>.md` here, resolved against the directory holding the `SKILL.md` you were routed through — the resolution rule Codex states for every relative path a skill writes. Expand it to an absolute path before putting it in a payload another context reads: the applier and the verifier open the rubric themselves and a relative path means nothing where they run.

## The state command

`OSO_STATE_BIN` reaches every tool subprocess on this host through the installer's `shell_environment_policy.set` entry, so `oso-state` is spelled `"${OSO_STATE_BIN:-oso-state}"` here.

This host publishes the fixed marker `OSO_AGENT=1` through `shell_environment_policy.set` for tool subprocesses and as an explicit environment prefix on every installed user-hook command. Spell repository-runtime state calls as `"${OSO_STATE_BIN:-oso-state}" --session "${OSO_AGENT}" <verb> …`. Runtime state is intentionally shared by repository, so this marker is audit metadata and the common value the `session` key — the OWNERSHIP identity — carries for model-issued state writes, the edit/commit readers, teardown and the git hook; never a claim that Codex supplied a hidden session id. For session-bound amend-plan, use the actual owning native CODEX_THREAD_ID, never OSO_AGENT. Handoff hooks keep the real payload session where same-session isolation is their contract. Plan approval keeps a second, separate key for the same reason: `plan_approval_session` is written only by `capture-plan` under the real session Stop observed, and `approve-plan`, `cancel-plan` and `amend-plan` compare against it rather than `session`, so a later `session`-overwriting write under the shared marker can never unbind a still-pending approval from the session that presented it.

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

When `../_shared/front-surface.md`'s trigger fires, READ `../_shared/references/codex.md`'s **Front-surface binding** section NOW. It is the single Codex binding for Impeccable's mounted path, all three argument routes, package-version record, agent route and absence remedy; this mode supplies only the PLAN wiring.

## Reporting binding

READ `../_shared/references/codex.md`'s **No card exists here** section NOW. It is the single Codex binding for what this host's own UI shows, and does not show, when the milestone contract at `../_shared/reporting.md` fires.
