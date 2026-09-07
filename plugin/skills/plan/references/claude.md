# Plan mode — Claude Code

## The delivery contract — anti-swallow

The Claude Code TUI drops assistant text that precedes a tool call in the same turn. Operator-facing content — the intent presentation, the surface-map presentation, any narrative the operator must read — must END the turn as plain text, with the tool call (`AskUserQuestion`, `ExitPlanMode`) in a LATER turn. Context a question round needs travels INSIDE the `AskUserQuestion` fields, never as prose before the call.

One exception stands, and `${CLAUDE_SKILL_DIR}/../_shared/references/claude.md`'s **The unattended run** section states it whole: the park and the final report still end the turn regardless.

## Question rounds

The tool is `AskUserQuestion`, and one round holds 4 questions maximum — its platform cap.

## The approval gate

`ExitPlanMode` is the single approval gate, and the plan document §5 builds is its `plan` argument — repaso-first, full-detail-after. The operator's approval there is what starts execution; on approval, exit Plan Mode.

Where this change runs as a child of the ROADMAP mode's chain, this gate is not its to reach: `${CLAUDE_SKILL_DIR}/../roadmap/references/claude.md` states what stands in its place — that mode's own one approval, and the plain-text delivery §5's document rides instead of the `plan` argument above.

## The explorer

§2 step 1's exploration subagents are the built-in `Explore` agent.

## Shared-file paths

Wherever the flow names a file as `_shared/<file>.md`, it is spelled `${CLAUDE_SKILL_DIR}/../_shared/<file>.md` here, resolved to an absolute path — what applier and verifier payloads need, since they open the rubric themselves.

## The state command

Every `oso-state <verb> …` the flow instructs runs as:

`"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" <verb> …`

The state is the repository's, not the session's — the session id is audit metadata only, and a write spelled without it does not run at all.

## The runtime gates, and the two layers of the commit rail

The commit and edits gates named in the ground rules are this plugin's own hooks, armed on `CLAUDE_CODE_SESSION_ID` — a value the client puts in every Bash-tool process and no operator terminal carries, so an operator committing here themselves never meets them. The commit rail has two layers (the git `pre-commit` hook and the `PreToolUse` matcher) because neither alone can see which worktree a commit comes from — the reason `_shared/parallel.md`'s wave loop opens a green window. The `SessionEnd` teardown reads `repo_path`, armed at §6, to run `git worktree remove`/`prune` in the named repo.

## What the unattended marker arms on this host

Three of this plugin's hooks read the `auto` marker the AUTO disposition writes:

- `auto-continue.sh` — the `Stop` net: reads `auto=running` and pushes the run on when a turn ends without parking or closing it, capped at a fixed number of pushes that moved the journal nowhere.
- `reanchor-after-compact.sh` — `SessionStart` with `source=compact`: hands the fresh context the three places the position lives — the `oso/index` row's `NEXT:` line, `oso-state show`, and the run journal.
- `block-prod-deploy.sh` — a `PreToolUse` rail armed only while the marker is running: a production deploy, and a push off the run's own branch, are denied. Taking the run back (`auto=done`) disarms it.

The marker is the flow's to write, never a hook's, exactly where `${CLAUDE_SKILL_DIR}/../_shared/unattended.md` puts each flip.

## The worktree root

`<worktree root>` in §6 is `~/.local/state/oso-code/worktrees/<sanitized session>` — `${CLAUDE_CODE_SESSION_ID}` with everything outside `a-zA-Z0-9-` stripped, exactly as the hooks do before they look.

## Naming and invoking the harness's own skills

| The flow says | Here it is | Reached by |
| --- | --- | --- |
| the QUICK mode | `oso-code:quick` | the operator invokes it — a mode is never model-invoked |
| the DEBUG mode | `oso-code:debug` | the operator invokes it — a mode is never model-invoked |
| the doubt-pass judge | `oso-code:doubt-pass` | the Skill tool; its frontmatter is what forks it |
| the debt-sweep judge | `oso-code:debt-sweep` | the Skill tool; its frontmatter is what forks it |
| the triage judge | `oso-code:triage` | the Skill tool; its frontmatter is what forks it |
| the security-pass judge | `oso-code:security-pass` | the Skill tool; its frontmatter is what forks it |

The three delegates the flow names — `oso-applier`, `oso-verifier`, `oso-integrator` — are agents, reached with the Agent tool under the wait rule below, each launch carrying that tool's own `model` parameter. An applier has no Skill tool of its own, which is why §6 step 2 hands it Impeccable's files as PATHS to read rather than a skill to invoke.

## Delegation-wait binding

READ `${CLAUDE_SKILL_DIR}/../_shared/references/claude.md`'s **Making a launch wait** section NOW, read ALWAYS by this flow. It is the single Claude Code binding for how a delegation's report arrives on this host and for the marker every delegation arms — reaching §6's applier, verifier and integrator, §2's exploration subagents, the integration gate's verifier, a red slice's relaunched applier, and §7's debt-cleanup applier. Its **The model a launch carries** section binds what that `model` parameter is set to, and is read in the same breath.

## Front-surface binding

When `${CLAUDE_SKILL_DIR}/../_shared/front-surface.md`'s trigger fires, READ `${CLAUDE_SKILL_DIR}/../_shared/references/claude.md`'s **Front-surface binding** section NOW. It is the single Claude Code binding for Impeccable's invocation, package-version record, agent route and absence remedy.

## Reporting binding

READ `${CLAUDE_SKILL_DIR}/../_shared/references/claude.md` NOW, read ALWAYS by this flow. Its **The native card is not the report** and **The unattended run** sections are the single Claude Code binding for what this host's own UI shows, and does not show, when the milestone contract at `${CLAUDE_SKILL_DIR}/../_shared/reporting.md` fires.
