# Debug mode — OpenCode

## The delivery contract

Operator-facing content the operator must answer or approve — the triage report, the diagnosis presentation — ENDS the turn as plain text, with any tool call in a LATER turn. Milestone reports are the exception: `../_shared/references/opencode.md`'s **Milestones ride the stream, and the record that carries them** lets each continue in the same turn with the next tool call.

## Making a launch wait

The child's own final message is the `subagent` tool's result, and that returned message is the whole of the handoff. Read it before any step that depends on it; the delegated fix this flow launches is exactly such a step. A launch that errors, times out or returns an empty verdict BLOCKS this flow and never falls through.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `../_shared/<file>.md` here, resolved against the directory holding the `SKILL.md` you were routed through — the resolution rule OpenCode states for every relative path a skill writes (the `skill` tool returns content with "Relative paths in this skill are relative to this base directory"). Expand it to an absolute path before putting it in a payload another context reads.

## The state command

`OSO_STATE_BIN` and `OSO_AGENT` reach every shell command on this host through the installed plugin's `shell.create.before` hook, whose env mutation reaches the spawned command. So `oso-state` is spelled `"${OSO_STATE_BIN:-oso-state}"` here.

The installed plugin publishes `OSO_AGENT`, a repository-derived identity computed from the shell's cwd, not a host session id. Spell every state call as `"${OSO_STATE_BIN:-oso-state}" --session "${OSO_AGENT}" <verb> …`. In a folder holding several repositories, run every `oso-state` call from the session's own directory, never with a workdir inside one of the repositories: state and `OSO_AGENT` key on the directory the call runs in.

## Naming and invoking the harness's own skills

Installed plugin skills carry NO namespace on this host: every skill auto-registers as a slash command under its own `name`, and the installed `opencode.json` carries `permission.skill` deny rules for the three operator-only modes, hiding them from the model while the slash command stays (D11; empirically verified on the pinned host). Operator-invoked modes use that command spelling; an orchestrator opens and reads auxiliary `SKILL.md` files in the installed tree.

| The body says | Here it is | Reached by |
| --- | --- | --- |
| the PLAN mode | `/oso-plan` | the operator invokes `/oso-plan` — a mode is never model-invoked |
| the quality-pass judge | `/oso-quality-pass` | read its installed `SKILL.md` and run it inline, the way it runs on every host |

Forked judges and operational agents are the exception to inline reading: launch them by their `opencode/agents/` contracts, passing SKILL PATH and ARGUMENTS in the payload (D10), under the wait rule above.

## The explorer

§4's diagnosis agent is launched through the `subagent` tool with a read-only agent.

## Front-surface binding

When `../_shared/front-surface.md`'s trigger fires, READ `../_shared/references/opencode.md`'s **Front-surface binding** section NOW. It is the single OpenCode binding for Impeccable's mounted path, all three argument routes, package-version record, agent route and absence remedy.

## Reporting binding

READ `../_shared/references/opencode.md`'s **Native agent files, no card** and **Milestones ride the stream, and the record that carries them** sections NOW. It is the single OpenCode binding for what this host's own UI shows, and does not show, when the milestone contract at `../_shared/reporting.md` fires.
