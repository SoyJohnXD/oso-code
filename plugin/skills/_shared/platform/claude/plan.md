# Plan mode — Claude Code

## The delivery contract — anti-swallow

The Claude Code TUI drops assistant text that precedes a tool call in the same turn. So operator-facing content — the intent presentation, the surface-map presentation, any narrative the operator must read — must END the turn as plain text, with the tool call (`AskUserQuestion`, `ExitPlanMode`) in a LATER turn. Context a question round needs travels INSIDE the `AskUserQuestion` fields (question text, option descriptions), never as prose before the call.

## Question rounds

The tool is `AskUserQuestion`, and one round holds 4 questions maximum — its platform cap. §2 step 5 feeds Decision rounds at that same number.

## The approval gate

`ExitPlanMode` is the single approval gate, and the plan document §5 builds is its `plan` argument — repaso-first, full-detail-after. Its native approval UI is what renders that document, and the operator's approval there is what starts execution. On approval, exit Plan Mode.

## Making a launch wait

Since client v2.1.198 a subagent runs in the BACKGROUND unless the call passes `run_in_background: false`, and a background result arrives in a LATER turn. So every subagent delegation §6 makes — applier, verifier and integrator alike — carries `run_in_background: false`, and that flag is what turns a delegation into the wait the neutral body requires, for one of them and for N in a single message alike.

## The explorer

§2 step 1's exploration subagents are the built-in `Explore` agent.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `${CLAUDE_SKILL_DIR}/../_shared/<file>.md` here. That interpolation resolves to an absolute path, which is what the applier and verifier payloads need — they are handed the rubric as a path they open themselves.

## The state command

Every `oso-state <verb> …` the neutral body instructs runs as:

`"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" <verb> …`

so `oso-state set mode=plan active_slice=<n> verify_green=false` is run as `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set mode=plan active_slice=<n> verify_green=false`, and `oso-state show`, `oso-state clear` and `oso-state event <verb> "<value>"` take the same prefix. The state itself is the repository's, not the session's — the session id is what the audit trail records each line under and what the teardown reads back — and a write spelled without it does not run at all.

## The runtime gates, and the two layers of the commit rail

The gates are this plugin's own hooks: they deny `git commit` while `verify_green` is false and deny file edits while no slice is active. The `pre-commit` hook arms on `CLAUDE_CODE_SESSION_ID`, which the client puts in every process the Bash tool starts and no operator's own terminal carries — so an operator committing in this repo themselves never meets it.

The commit rail has two layers and the wave loop's green window (§6) exists because neither can see which worktree a commit comes from:

- the git `pre-commit` hook, because `core.hooksPath` is an absolute path every linked worktree inherits and the state it reads is the repository's, not the tree it fired in;
- the `PreToolUse` matcher, because it reads the command line and nothing else.

The teardown §6 arms `repo_path` for is the `SessionEnd` hook, which runs `git worktree remove` and `git worktree prune` in the repo named there.

## The worktree root

`<worktree root>` in §6 is `~/.local/state/oso-code/worktrees/<sanitized session>`, where sanitized is `${CLAUDE_CODE_SESSION_ID}` with everything outside `a-zA-Z0-9-` stripped — which is what the hooks do to it before they look, so a path spelled any other way is a path the teardown never finds.

## Naming and invoking the harness's own skills

The neutral body names each one by role; here they carry the plugin prefix, and each is reached through the Skill tool:

| The body says | Here it is | Reached by |
| --- | --- | --- |
| the QUICK mode | `oso-code:quick` | the operator invokes it — a mode is never model-invoked |
| the DEBUG mode | `oso-code:debug` | the operator invokes it — a mode is never model-invoked |
| the doubt-pass judge | `oso-code:doubt-pass` | the Skill tool; its frontmatter is what forks it |
| the debt-sweep judge | `oso-code:debt-sweep` | the Skill tool; its frontmatter is what forks it |
| the triage judge | `oso-code:triage` | the Skill tool; its frontmatter is what forks it |
| the security-pass judge | `oso-code:security-pass` | the Skill tool; its frontmatter is what forks it |

The three delegates the body names — `oso-applier`, `oso-verifier`, `oso-integrator` — are agents, not skills: reach them with the Agent tool, under the wait rule above. An applier has no Skill tool of its own, which is why §6 step 2 hands it Impeccable's files as PATHS to read rather than a skill to invoke.

## Front-surface binding

When `../../front-surface.md`'s trigger fires, READ `front-surface.md` beside this file NOW. It is the single Claude Code binding for Impeccable's invocation, package-version record, agent route and absence remedy; this mode supplies only the PLAN wiring indexed by the neutral matrix.
