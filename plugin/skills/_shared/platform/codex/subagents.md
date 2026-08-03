# Delegated roles — Codex

Codex gives every delegated harness step a custom role. The role is selected when the subagent is spawned; the role name, not a summary of its job, is the contract boundary.

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

The four reviewer roles are thin fresh-context adapters over the installed skills. Before spawning one, resolve its Codex `SKILL.md` to an absolute path. Give the role that path as `SKILL PATH` and give the skill's normal invocation payload as `ARGUMENTS`. The reviewer reads the wrapper and every bound neutral and Codex-platform file itself; the orchestrator never reads a forked judgment inline and never substitutes a summary for those files.

Role selection settles WHO runs the delegation. It does not settle WHEN the caller may consume the result: the host file's “Making a launch wait” section remains binding, and slice S6's handshake is still the precondition for every launch the neutral body says to wait on.
