# Debug mode — Codex

## The delivery contract

No swallow is known on this host, and this port has not probed for one. So the discipline stands unchanged rather than relaxed: operator-facing content — the triage report, the diagnosis presentation — ENDS the turn as plain text, with any tool call in a LATER turn. An extra turn is the cheap side of that bet; content the operator never sees is the expensive one.

## Making a launch wait

This host exposes no foreground flag on a launch. Use Codex's wait operation, then the receipt protocol in `../_shared/references/codex.md`'s **Completion handshake** section: its `--timeout 10` is the common bound, and `handoff consume` is the one-shot precondition for reading that message's verdict. A timeout or identity mismatch blocks this launch; it never falls through to the next step.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `../_shared/<file>.md` here, resolved against the directory holding the `SKILL.md` you were routed through — the resolution rule Codex states for every relative path a skill writes. Expand it to an absolute path before putting it in a payload another context reads.

## The state command

`OSO_STATE_BIN` reaches every tool subprocess on this host through the installer's `shell_environment_policy.set` entry, so `oso-state` is spelled `"${OSO_STATE_BIN:-oso-state}"` here.

The installer publishes the fixed marker `OSO_AGENT=1` through `shell_environment_policy.set` for tool subprocesses and as an explicit prefix on user-hook commands. Spell every state call as `"${OSO_STATE_BIN:-oso-state}" --session "${OSO_AGENT}" <verb> …`. The installed user hooks and git hook read the same marker; until the operator has reviewed and trusted the user hooks through `/hooks`, report that the local-function layer is installed but not trusted.

## Naming and invoking the harness's own skills

Installed plugin skills carry Codex's `oso-code:` namespace. Operator-invoked modes use that full identity; an orchestrator opens and reads auxiliary `SKILL.md` files in the installed plugin.

| The body says | Here it is | Reached by |
| --- | --- | --- |
| the PLAN mode | `oso-code:plan` | the operator invokes `$oso-code:plan` — a mode is never model-invoked |
| the quality-pass judge | `oso-code:quality-pass` | read its installed `SKILL.md` and run it inline, the way it runs on every host |

Forked judges and operational agents are the exception to inline reading. READ `../_shared/references/codex.md`'s **Delegated roles** and **Completion handshake** sections NOW and use them as binding.

## Front-surface binding

When `../_shared/front-surface.md`'s trigger fires, READ `../_shared/references/codex.md`'s **Front-surface binding** section NOW. It is the single Codex binding for Impeccable's mounted path, all three argument routes, package-version record, agent route and absence remedy.

## Reporting binding

READ `../_shared/references/codex.md`'s **No card exists here** section NOW. It is the single Codex binding for what this host's own UI shows, and does not show, when the milestone contract at `../_shared/reporting.md` fires.
