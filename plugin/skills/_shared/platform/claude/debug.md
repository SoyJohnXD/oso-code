# Debug mode — Claude Code

## The delivery contract — anti-swallow

The Claude Code TUI drops assistant text that precedes a tool call in the same turn. So operator-facing content — the triage report, the diagnosis presentation, any narrative the operator must read — must END the turn as plain text, with the tool call in a LATER turn.

One exception stands and `reporting.md` beside this file states it whole rather than this section restating it: while this repository's state carries `auto=running`, the run is UNATTENDED and its milestone text rides the stream instead of ending the turn, journaled full-text in its place. This mode arms no such marker of its own — a fix run reaches its operator at the diagnosis either way — so the exception reads inert here unless a run that armed it is what this flow was invoked from.

## Making a launch wait

This host offers no foreground flag on a launch — the flag this section claimed until now is retired, because the `Agent` tool's schema never carried it. That tool always launches in the BACKGROUND and returns at once, with the agent id and nothing about the work.

The delegation's report therefore arrives in a LATER turn, as a completion notification that re-enters the conversation. That notification IS the resume. The turn that launched ends there, and ending it is correct rather than a stall.

**Nothing may act on a report it has not read.** A step taken before the notification arrives is a step taken on a verdict nobody has, which is the whole reason the neutral body requires the read at all. So never predict, assume or report a delegation's result before its notification, and never relaunch a delegation that is in flight — the notification is what resumes it, and a second launch over the same tree is two writers in one slice.

**The marker.** Before any launch whose result arrives in a later turn, arm `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set auto_wait=<label>` — the label being the slice number or `wave-<n>`, matching `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$` — and return it to `auto_wait=none` the same way once every report for that label has been read. Under an unattended run this is what stops the `Stop` net counting a delegation's turn-end as a stall; the net believes a mark for 45 minutes and then stops believing it, so a mark left armed EXPIRES rather than disarming the net for good. Arm it on EVERY delegation and not only under `auto=running`: one unconditional rule survives a compaction where a conditional the orchestrator must re-derive does not, and nothing reads the key without the marker, so an attended run pays only the write.

This governs every launch made through the Agent tool, named by that property rather than by a list the next tool change would falsify — §4's applier and verifier, §5's debt-cleanup applier.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `${CLAUDE_SKILL_DIR}/../_shared/<file>.md` here. That interpolation resolves to an absolute path, which is what a payload handed to another context needs.

## The state command

Every `oso-state <verb> …` the neutral body instructs runs as:

`"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" <verb> …`

so `oso-state set mode=debug active_slice=fix verify_green=false` is run as `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set mode=debug active_slice=fix verify_green=false`, and `oso-state show` and `oso-state clear` take the same prefix. The gates that read what those writes leave behind are this plugin's own hooks, and they key their read on the REPOSITORY the write was made in — the session id is what the audit trail records each line under, and a write spelled without it does not run at all.

## Naming and invoking the harness's own skills

The neutral body names each one by role; here they carry the plugin prefix, and each is reached through the Skill tool:

| The body says | Here it is | Reached by |
| --- | --- | --- |
| the PLAN mode | `oso-code:plan` | the operator invokes it — a mode is never model-invoked |
| the quality-pass judge | `oso-code:quality-pass` | the Skill tool |
| the debt-sweep judge | `oso-code:debt-sweep` | the Skill tool; its frontmatter is what forks it |
| the security-pass judge | `oso-code:security-pass` | the Skill tool; its frontmatter is what forks it |

The two delegates the body names — `oso-applier`, `oso-verifier` — are agents, not skills: reach them with the Agent tool, under the wait rule above.

## Front-surface binding

When `../../front-surface.md`'s trigger fires, READ `front-surface.md` beside this file NOW. It is the single Claude Code binding for Impeccable's invocation, package-version record, agent route and absence remedy. This mode supplies only the DEBUG wiring indexed by the neutral matrix, which still invokes none of the three arguments.

## Reporting binding

READ `reporting.md` beside this file NOW. It is the single Claude Code binding for what this host's own UI shows, and does not show, when the milestone contract at `../../reporting.md` fires.
