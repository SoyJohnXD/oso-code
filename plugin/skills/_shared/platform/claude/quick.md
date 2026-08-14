# Quick mode — Claude Code

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `${CLAUDE_SKILL_DIR}/../_shared/<file>.md` here. That interpolation resolves to an absolute path, which is what a payload handed to another context needs.

## The state command

Every `oso-state <verb> …` the neutral body instructs runs as:

`"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" <verb> …`

so `oso-state set mode=quick active_slice=none verify_green=false` is run as `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set mode=quick active_slice=none verify_green=false`, and `oso-state show` and `oso-state clear` take the same prefix. The gates that read what those writes leave behind are this plugin's own hooks, and they key their read on the REPOSITORY the write was made in — the session id is what the audit trail records each line under, and a write spelled without it does not run at all.

## Naming and invoking the harness's own skills

The neutral body names each one by role; here they carry the plugin prefix, and each is reached through the Skill tool:

| The body says | Here it is | Reached by |
| --- | --- | --- |
| the PLAN mode | `/oso-code:plan` | the operator invokes it — a mode is never model-invoked |
| the DEBUG mode | `oso-code:debug` | the operator invokes it — a mode is never model-invoked |
| the quality-pass judge | `oso-code:quality-pass` | the Skill tool |
| the security-pass judge | `oso-code:security-pass` | the Skill tool; its frontmatter is what forks it |

The delegate the close names — `oso-applier` — is an agent, not a skill: reach it with the Agent tool, under the wait rule `plan.md` beside this file states whole rather than this file restating it — read it there before delegating.

## Front-surface binding

When `../../front-surface.md`'s trigger fires, READ `front-surface.md` beside this file NOW. It is the single Claude Code binding for Impeccable's invocation, package-version record, agent route and absence remedy; this mode supplies only the QUICK wiring indexed by the neutral matrix.

## Reporting binding

READ `reporting.md` beside this file NOW. It is the single Claude Code binding for what this host's own UI shows, and does not show, when the milestone contract at `../../reporting.md` fires.
