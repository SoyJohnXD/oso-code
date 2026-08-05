# Delegated roles — Codex

Codex gives every delegated harness step a custom role. The role is selected when the subagent is spawned; the role name, not a summary of its job, is the contract boundary.

Every launch that selects an explicit `agent_type` starts with fresh context: set `fork_turns="none"`. The call is `codex.multi_agent.spawn` in its v2 shape, which also names the child through `task_name`; ADR-0105 records that host contract. An omitted `fork_turns` is a full-history fork, and ADR-0102 forbids combining one with an explicit custom or built-in role because a full-history fork inherits the parent's agent type. The payload must therefore carry every path, ref, assignment, skill route, handoff field and decision the selected role needs.

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

The three operational roles carry their complete contract in their agent definition. Give them the payload the neutral body names. Because a Codex role cannot set its working directory, every applier and verifier payload includes the absolute WORKTREE PATH and BASE REF, and every integrator payload also includes the absolute main-checkout path beside the wave's branches and worktrees.

The four reviewer roles are thin fresh-context adapters over the installed skills. Before spawning one, resolve its Codex `SKILL.md` to an absolute path. Give the role that path as `SKILL PATH` and give the skill's normal invocation payload as `ARGUMENTS`. The reviewer reads the wrapper and every bound neutral and Codex-platform file itself; the orchestrator never reads a delegated judgment inline and never substitutes a summary for those files.

## Completion handshake

Every delegated payload carries two transport fields beside its semantic assignment: `HANDOFF SLICE`, a safe identifier made only of letters, digits, `_` and `-`, and `HANDOFF ATTEMPT`, a positive integer incremented on every relaunch of that slice. It also tells the subagent to begin its final message with exactly one line in this form:

`oso-handoff: v=1 slice=<ID> attempt=<N>`

Replace `<ID>` and `<N>` with the two payload fields; angle brackets never reach the message. That line is a transport envelope outside the report shapes the role or judge declares. The exact report follows it, so the report's required terminal verdict remains the message's final line. Codex's user-level `SubagentStop` hook reads `last_assistant_message` outside the child's sandbox and atomically publishes a receipt containing the hook session as metadata plus the slice, attempt, agent id and agent type. The receipt never carries `verdict`, `status`, findings, report text or a second copy of the message.

After spawning, retain the unique agent id Codex returns, use Codex's wait operation and read the returned message. Then run `oso-state handoff wait` for the exact slice, attempt, agent id and agent type with `--timeout 10`, followed by `oso-state handoff consume` with the same four fields. Ten seconds is the host-wide bound because `SubagentStop` has already run before Codex returns the message. These handoff commands need no session id: the unique agent id keeps simultaneous sessions and repeat attempts apart, while the repository the command runs in supplies the outer key. Only a successful one-shot consume satisfies the FILE PRECONDITION for interpreting the report. A receipt from an earlier attempt, another slice or another agent is not evidence for this launch; a missing current receipt times out and blocks the flow instead of being guessed green.

The MESSAGE is always the verdict. The receipt proves only that the matching `SubagentStop` observed a complete message and that this caller consumed it once. Never derive pass, fail, blocked, done, clean or findings from the file, and never continue from a receipt when the returned message says otherwise.
