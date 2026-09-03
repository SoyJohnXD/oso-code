# Debug mode — OpenCode

## The delivery contract

No swallow is known on this host, and this port has not probed for one. So the discipline stands unchanged rather than relaxed: operator-facing content — the triage report, the diagnosis presentation — ENDS the turn as plain text, with any tool call in a LATER turn. An extra turn is the cheap side of that bet; content the operator never sees is the expensive one.

## Making a launch wait

No launch on this host outlives the turn that made it: the `task` tool is SYNCHRONOUS — the call blocks until the child turn completes and the child's own final message comes back in-band (D5) — and there is no wait operation and no handoff receipt rail beside it, so that returned message is the whole of the handoff. Read it before any step that depends on it; the delegated fix this flow launches is exactly such a step. A launch that errors, times out or returns an empty verdict BLOCKS this flow and never falls through, and `auto_wait` is never armed here because nothing this flow launches reports in a later turn — `../../oso-plan/references/opencode.md` states the same rule for the run that reads that marker.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `../_shared/<file>.md` here, resolved against the directory holding the `SKILL.md` you were routed through — the resolution rule OpenCode states for every relative path a skill writes (the `skill` tool returns content with "Relative paths in this skill are relative to this base directory"). Expand it to an absolute path before putting it in a payload another context reads.

## The state command

`OSO_STATE_BIN` reaches every tool subprocess on this host through the installed plugin's `shell.env` hook — which fires per shell invocation and whose `output.env` values ARE present in the tool process environment. So `oso-state` is spelled `"${OSO_STATE_BIN:-oso-state}"` here.

This host publishes the ROOT session id through `shell.env` for tool subprocesses (D13); that value is what `OSO_AGENT` carries, and it is never exported into the server process itself. Spell every state call as `"${OSO_STATE_BIN:-oso-state}" --session "${OSO_AGENT}" <verb> …`.

## Naming and invoking the harness's own skills

Installed plugin skills carry NO namespace on this host: every skill auto-registers as a slash command under its own `name`, and the installed `opencode.json` carries `permission.skill` deny rules for the three operator-only modes, hiding them from the model while the slash command stays (D11; empirically verified on the pinned host). Operator-invoked modes use that command spelling; an orchestrator opens and reads auxiliary `SKILL.md` files in the installed tree.

| The body says | Here it is | Reached by |
| --- | --- | --- |
| the PLAN mode | `/oso-plan` | the operator invokes `/oso-plan` — a mode is never model-invoked |
| the quality-pass judge | `/oso-quality-pass` | read its installed `SKILL.md` and run it inline, the way it runs on every host |

Forked judges and operational agents are the exception to inline reading: launch them by their `opencode/agents/` contracts, passing SKILL PATH and ARGUMENTS in the payload (D10), under the wait rule above.

## Front-surface binding

When `../_shared/front-surface.md`'s trigger fires, READ `../_shared/references/opencode.md`'s **Front-surface binding** section NOW. It is the single OpenCode binding for Impeccable's mounted path, all three argument routes, package-version record, agent route and absence remedy. This mode supplies only the DEBUG wiring, which still invokes none of the three arguments.

## Reporting binding

READ `../_shared/references/opencode.md`'s **Native agent files, no card** and **The unattended run — no carve-out here, and the record that carries it instead** sections NOW. It is the single OpenCode binding for what this host's own UI shows, and does not show, when the milestone contract at `../_shared/reporting.md` fires.
