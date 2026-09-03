# Quick mode — OpenCode

## The delivery contract

The adapter makes no claim about whether OpenCode preserves operator-facing text before a same-turn tool call, and the harness depends on no such behavior. It applies the conservative host-independent policy: operator-facing content ENDS the turn as plain text, with any tool call in a LATER turn. An extra turn is the cheap side of that boundary; content the operator never sees is the expensive one.

## Question rounds

The tool is `question`, and it is available only when the operator is watching the TUI: headless sessions deny `question` by default. Its schema accepts several questions in one call — the operator navigates between them before submitting all answers — so a round holds 3 questions at a time. A fourth question starts the next round; it never rides an invalid call and never gets dropped.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `../_shared/<file>.md` here, resolved against the directory holding the `SKILL.md` you were routed through — the resolution rule OpenCode states for every relative path a skill writes (the `skill` tool returns content with "Relative paths in this skill are relative to this base directory"). Expand it to an absolute path before putting it in a payload another context reads.

## The state command

`OSO_STATE_BIN` reaches every tool subprocess on this host through the installed plugin's `shell.env` hook — which fires per shell invocation and whose `output.env` values ARE present in the tool process environment. So `oso-state` is spelled `"${OSO_STATE_BIN:-oso-state}"` here.

What the state is keyed by is settled and is host-neutral: the state file is the REPOSITORY's, resolved from the directory the command runs in.

This host publishes the ROOT session id through `shell.env` for tool subprocesses (D13); that value is what `OSO_AGENT` carries, and it is never exported into the server process itself. Spell every state call as `"${OSO_STATE_BIN:-oso-state}" --session "${OSO_AGENT}" <verb> …`.

## Naming and invoking the harness's own skills

Installed plugin skills carry NO namespace on this host: every skill auto-registers as a slash command under its own `name`, and the installed `opencode.json` carries `permission.skill` deny rules for the three operator-only modes, hiding them from the model while the slash command stays (D11; empirically verified on the pinned host). Operator-invoked modes use that command spelling; an orchestrator opens and reads auxiliary `SKILL.md` files in the installed tree.

| The body says | Here it is | Reached by |
| --- | --- | --- |
| the PLAN mode | `/oso-plan` | the operator invokes `/oso-plan` — a mode is never model-invoked |
| the DEBUG mode | `/oso-debug` | the operator invokes `/oso-debug` — a mode is never model-invoked |
| the quality-pass judge | `/oso-quality-pass` | read its installed `SKILL.md` and run it inline, the way it runs on every host |

Forked judges and operational agents are the exception to inline reading. This host's `task` tool is SYNCHRONOUS — its call blocks until the child turn completes and the verdict is in-band (plan §3 trap 5, D5). There is no wait operation and no handoff receipt rail on this host (D5); a launch that errors, times out, or returns an empty verdict blocks the flow and never falls through. Launch the judge adapters by their `opencode/agents/` contracts, passing SKILL PATH and ARGUMENTS in the payload (D10).

## Front-surface binding

When `../_shared/front-surface.md`'s trigger fires, READ `../_shared/references/opencode.md`'s **Front-surface binding** section NOW. It is the single OpenCode binding for Impeccable's mounted path, all three argument routes, package-version record, agent route and absence remedy; this mode supplies only the QUICK wiring indexed by the neutral matrix.

## Reporting binding

READ `../_shared/references/opencode.md`'s **Native agent files, no card** and **The unattended run — no carve-out here, and the record that carries it instead** sections NOW. It is the single OpenCode binding for what this host's own UI shows, and does not show, when the milestone contract at `../_shared/reporting.md` fires.
