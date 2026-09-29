# Plan mode — Claude Code

## The delivery contract — anti-swallow

The Claude Code TUI drops assistant text that precedes a tool call in the same turn. Operator-facing content must END the turn as plain text, with the tool call (`AskUserQuestion`, `ExitPlanMode`) in a LATER turn. Context a question round needs travels INSIDE the `AskUserQuestion` fields, never as prose before the call.

One exception stands, stated whole in `${CLAUDE_SKILL_DIR}/../_shared/references/claude.md`'s **The unattended run** section: the park and the final report still end the turn regardless.

## Question rounds

The tool is `AskUserQuestion`, and one round holds 4 questions maximum.

## The approval gate

`ExitPlanMode` is the single approval gate, and the plan document §5 builds is its `plan` argument — repaso-first, full-detail-after. The operator's approval there starts execution; on approval, exit Plan Mode.

Where this change runs as a child of the ROADMAP mode's chain, this gate is not its to reach: `${CLAUDE_SKILL_DIR}/../roadmap/references/claude.md` states what stands in its place.

## The explorer

§2 step 1's exploration subagents are the built-in `Explore` agent.

## Shared-file paths

Wherever the flow names a file as `_shared/<file>.md`, it is spelled `${CLAUDE_SKILL_DIR}/../_shared/<file>.md` here, resolved to an absolute path wherever an applier or verifier payload carries it.

## The state command

Every `oso-state <verb> …` the flow instructs runs as:

`"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" <verb> …`

The state is the repository's; the session id is audit metadata, yet a write without it does not run.

## The runtime gates, and the two layers of the commit rail

The commit and edits gates are this plugin's own hooks, armed on `CLAUDE_CODE_SESSION_ID`, which no operator terminal carries. The commit rail has two layers, the git `pre-commit` hook and the `PreToolUse` matcher, since neither alone sees which worktree a commit comes from. The `SessionEnd` teardown reads `repo_path`, armed by the wave loop, to run `git worktree remove`/`prune` in the named repo.

## What the unattended marker arms on this host

Three gates in `dist/gate.js`, dispatched by `hooks/hooks.json`, read the `auto` marker the AUTO disposition writes:

- the autocontinue gate — the `Stop` net, bound in the shared host file's **The unattended run** section.
- the reanchor gate — `SessionStart` with `source=compact`: hands the fresh context the three places the position lives — the `oso/index` row's `NEXT:` line, `oso-state show`, and the run journal.
- the production-deploy gate — a `PreToolUse` rail armed only while the marker is running: a production deploy, and a push off the run's own branch, are denied. Taking the run back (`auto=done`) disarms it.

The marker is the flow's to write, never a gate's.

## The worktree root

`<worktree root>` is `~/.local/state/oso-code/worktrees/<sanitized session>` — `${CLAUDE_CODE_SESSION_ID}` with everything outside `a-zA-Z0-9-` stripped, as the hooks do.

## Naming and invoking the harness's own skills

The QUICK and DEBUG modes are `oso-code:quick` and `oso-code:debug`, which the operator invokes — a mode is never model-invoked. The doubt-pass, debt-sweep, triage and security-pass judges are `oso-code:doubt-pass`, `oso-code:debt-sweep`, `oso-code:triage` and `oso-code:security-pass`, reached with the Skill tool; each one's frontmatter is what forks it.

The three delegates the flow names — `oso-applier`, `oso-verifier`, `oso-integrator` — are agents, reached with the Agent tool, each launch carrying its own `model` parameter. An applier has no Skill tool of its own, so a front-surface slice hands it Impeccable's files as PATHS to read rather than a skill to invoke.

## The shared host file

`${CLAUDE_SKILL_DIR}/../_shared/references/claude.md` is read ALWAYS by this flow: the single Claude Code binding for **Making a launch wait**, **The model a launch carries**, the native card, the unattended run, and the front-surface wiring.
