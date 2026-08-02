# Debug mode — Claude Code

## The delivery contract — anti-swallow

The Claude Code TUI drops assistant text that precedes a tool call in the same turn. So operator-facing content — the triage report, the diagnosis presentation, any narrative the operator must read — must END the turn as plain text, with the tool call in a LATER turn.

## Making a launch wait

Since client v2.1.198 a subagent runs in the BACKGROUND unless the call passes `run_in_background: false`, and a background result arrives in a LATER turn. So every subagent delegation §4 makes — applier and verifier alike — carries `run_in_background: false`, and that flag is what turns a delegation into the wait the neutral body requires.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `${CLAUDE_SKILL_DIR}/../_shared/<file>.md` here. That interpolation resolves to an absolute path, which is what a payload handed to another context needs.

## The state command

Every `oso-state <verb> …` the neutral body instructs runs as:

`"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" <verb> …`

so `oso-state set mode=debug active_slice=fix verify_green=false` is run as `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set mode=debug active_slice=fix verify_green=false`, and `oso-state show` and `oso-state clear` take the same prefix. The gates that read what those writes leave behind are this plugin's own hooks, and they key their read on that session id — so a write spelled without it lands in nobody's state and the commit gate stays open with no other signal.

## Naming and invoking the harness's own skills

The neutral body names each one by role; here they carry the plugin prefix, and each is reached through the Skill tool:

| The body says | Here it is | Reached by |
| --- | --- | --- |
| the PLAN mode | `oso-code:plan` | the operator invokes it — a mode is never model-invoked |
| the quality-pass judge | `oso-code:quality-pass` | the Skill tool |
| the debt-sweep judge | `oso-code:debt-sweep` | the Skill tool; its frontmatter is what forks it |
| the security-pass judge | `oso-code:security-pass` | the Skill tool; its frontmatter is what forks it |
| the Impeccable skill | `impeccable:impeccable` | the Skill tool |

The two delegates the body names — `oso-applier`, `oso-verifier` — are agents, not skills: reach them with the Agent tool, under the wait rule above.
