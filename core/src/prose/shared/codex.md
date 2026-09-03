# Shared layer — Codex

Host binding for the shared concerns that bind no single wrapper: Codex's delegated-role map and completion handshake, `../front-surface.md`'s wiring, and `../reporting.md`'s delivery. Every skill file that reaches one of them points here rather than restating it.

## Delegated roles

Codex gives every delegated harness step a custom role. The role is selected when the subagent is spawned; the role name, not a summary of its job, is the contract boundary.

Every launch that selects an explicit `agent_type` starts with fresh context: set `fork_turns="none"`. The call is `codex.multi_agent.spawn` in its v2 shape, which also names the child through `task_name`. An omitted `fork_turns` is a full-history fork, and combining one with an explicit custom or built-in role is forbidden because a full-history fork inherits the parent's agent type. The payload must therefore carry every path, ref, assignment, skill route, handoff field and decision the selected role needs.

| The neutral body delegates | Custom role |
| --- | --- |
| apply one assignment | `oso-applier` |
| verify a slice or merged wave | `oso-verifier` |
| integrate one wave | `oso-integrator` |
| doubt-pass | `oso-doubt-pass` |
| debt-sweep | `oso-debt-sweep` |
| triage | `oso-triage` |
| security-pass | `oso-security-reviewer` |

Surface exploration is separate from those seven files: use Codex's built-in `explorer` role. It inherits the parent Plan Mode's read-only permission and must not be duplicated as an eighth custom TOML.

The three operational roles carry their complete contract in their agent definition. Give them the payload the neutral body names. Because a Codex role cannot set its working directory, every applier and verifier payload includes the absolute WORKTREE PATH and the ref coordinate the body names for that launch — SLICE START or WAVE START — and every integrator payload also includes the absolute main-checkout path beside the wave's branches and worktrees.

The four reviewer roles are thin fresh-context adapters over the installed skills. Before spawning one, resolve its Codex `SKILL.md` to an absolute path. Give the role that path as `SKILL PATH` and give the skill's normal invocation payload as `ARGUMENTS`. The reviewer reads the wrapper and every bound neutral and Codex reference file itself; the orchestrator never reads a delegated judgment inline and never substitutes a summary for those files.

## Completion handshake

Every delegated payload carries two transport fields beside its semantic assignment: `HANDOFF SLICE`, a safe identifier made only of letters, digits, `_` and `-`, and `HANDOFF ATTEMPT`, a positive integer incremented on every relaunch of that slice. It also tells the subagent to begin its final message with exactly one line in this form:

`oso-handoff: v=1 slice=<ID> attempt=<N>`

Replace `<ID>` and `<N>` with the two payload fields; angle brackets never reach the message. That line is a transport envelope outside the report shapes the role or judge declares. The exact report follows it, so the report's required terminal verdict remains the message's final line. Codex's user-level `SubagentStop` hook reads `last_assistant_message` outside the child's sandbox and atomically publishes a receipt containing the hook session as metadata plus the slice, attempt, agent id and agent type. The receipt never carries `verdict`, `status`, findings, report text or a second copy of the message.

After spawning, retain the unique agent id Codex returns, use Codex's wait operation and read the returned message. Then run `oso-state handoff wait` for the exact slice, attempt, agent id and agent type with `--timeout 10`, followed by `oso-state handoff consume` with the same four fields. Ten seconds is the host-wide bound because `SubagentStop` has already run before Codex returns the message. These handoff commands need no session id: the unique agent id keeps simultaneous sessions and repeat attempts apart, while the repository the command runs in supplies the outer key. Only a successful one-shot consume satisfies the FILE PRECONDITION for interpreting the report. A receipt from an earlier attempt, another slice or another agent is not evidence for this launch; a missing current receipt times out and blocks the flow instead of being guessed green.

The MESSAGE is always the verdict. The receipt proves only that the matching `SubagentStop` observed a complete message and that this caller consumed it once. Never derive pass, fail, blocked, done, clean or findings from the file, and never continue from a receipt when the returned message says otherwise.

## Front-surface binding

This binds the platform-shaped edges of `../front-surface.md`; it does not restate that file's trigger, pin recipe, audit exit bar or absence policy.

- The mode labels are the bare `plan`, `quick` and `debug` skills.
- The stable Impeccable skill is `~/.agents/skills/impeccable/SKILL.md`, materialized inside its user-wide root as a real, symlink-free copy by the installer and never used through its source plugin-cache path. When a shell or payload needs the expanded spelling, use the absolute `$HOME/.agents/skills/impeccable/SKILL.md`.
- Invoke the mounted skill as `$impeccable <argument>`: `$impeccable init`, `$impeccable document` and `$impeccable audit <touched surfaces>` are the three routes. The words are explicit arguments to the one skill, never standalone skill names or Claude slash commands.
- For a harness-owned invocation, read the mounted `SKILL.md` completely, pass the exact ARGUMENT `init`, `document` or `audit <touched surfaces>`, then load and follow the command's mounted reference. Do not approximate an argument from memory or treat reading only `reference/` as loading the skill.
- The filesystem payload to an applier uses that absolute `SKILL.md` plus its `reference/` directory, also expanded below `$HOME/.agents/skills/impeccable/`. The applier reads those files; it does not invoke the skill and is never handed the source cache path.
- Record the independent installed-skill numeral from the `version:` field in the mounted `SKILL.md`; the npm CLI numeral still comes from the neutral pin recipe. Never inspect the source cache merely to obtain the mounted version.
- Route design findings to the `oso-applier` subagent in fresh context through the **Delegated roles** and **Completion handshake** sections above.
- When Impeccable is absent, ask the operator to rerun `node bootstrap/oso.js install --host codex`. That install does not mount Impeccable itself, so continue without the design bar and record the gap where the invoking mode requires; never repeat Claude's `/plugin` commands and never use a discovered cache path as a temporary mount.

## No card exists here

This host draws no card for a spawned role or a waited-on handoff: the **Delegated roles** and **Completion handshake** sections above are transport, invisible to the operator unless the milestone text itself says what happened. The contract at `../reporting.md` is therefore this host's WHOLE visibility layer, not a complement to a native affordance, and it is delivered exactly as every other operator-facing content on this host: ending the turn as plain text, with any tool call in a later turn. Claude Code carves an unattended run's milestones out of that same rule while `auto=running` stands, and OpenCode arms a rail that lets it skip the carve-out safely; this host takes neither, so while that marker stands a milestone still ends the turn exactly as above, with nothing here to carry the run past it.
