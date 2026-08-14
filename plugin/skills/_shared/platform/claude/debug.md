# Debug mode — Claude Code

## The delivery contract — anti-swallow

The Claude Code TUI drops assistant text that precedes a tool call in the same turn. So operator-facing content — the triage report, the diagnosis presentation, any narrative the operator must read — must END the turn as plain text, with the tool call in a LATER turn.

One exception stands and `reporting.md` beside this file states it whole rather than this section restating it: while this repository's state carries `auto=running`, the run is UNATTENDED and its milestone text rides the stream instead of ending the turn, journaled full-text in its place. This mode arms no such marker of its own — a fix run reaches its operator at the diagnosis either way — so the exception reads inert here unless a run that armed it is what this flow was invoked from.

## Making a launch wait

Since client v2.1.198 a subagent runs in the BACKGROUND unless the call passes `run_in_background: false`, and a background result arrives in a LATER turn. So every subagent delegation §4 makes — applier and verifier alike — carries `run_in_background: false`, and that flag is what turns a delegation into the wait the neutral body requires.

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
