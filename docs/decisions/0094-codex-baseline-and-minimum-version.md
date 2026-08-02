# 0094 — The verified Codex baseline, and the minimum version the harness supports

Date: 2026-08-02
Status: accepted
Implemented-in: tests/hooks-test.sh
Reconciled: elsewhere — landed in tests/hooks-test.sh, which holds the declared floor; the frozen body never carried a Codex version, and the installer that pins this number is a later slice.
Source: this change (Codex port), ledger decision D14; recorded with the change that made it

## Decision

Minimum supported Codex: 0.146.0

The number is a floor, not a range. Every fact this port rests on was read out of a 0.146.0 CLI on 2026-08-02 by running the tool, and nothing below that version has been checked since the port was designed. Ledger D14 has the installer PIN this version rather than `@latest`, so the pin and this line move together: a Codex release that moves a load-bearing flag is a new decision here first and a new number second, never a silent `@latest` that changes the harness under the operator.

The two mechanisms ledger D2's state-identity fix rests on were PROVEN at this version rather than reasoned about, and only one of them holds in the form it was written:

- `shell_environment_policy.set` exists, is a string-to-string map, and hard-sets a variable for tool subprocesses — it is applied after inheritance and after both exclude passes, so it OVERRIDES an inherited value rather than filling a gap. `include_only` is applied after it, so a non-empty `include_only` that does not match the set name filters it back out.
- `git rev-parse --git-common-dir` is NOT a stable identity in its bare form. It answers `.git` in the main checkout and an absolute path inside a linked worktree, so the two are not the same string for the same repository. The stable spelling is `git rev-parse --path-format=absolute --git-common-dir`, which answers the identical absolute path from the main checkout, from a linked worktree, and from a subdirectory of one. D2's worktree fix has to be written with `--path-format=absolute` or it computes two identities for one repo.

## Context

The port was planned against `codex-cli 0.140.0` while npm published 0.146.0 — six versions of drift under decisions that read feature flags and artifact schemas straight off the installed CLI. The update ran through the official path (`codex update`, which shells out to `npm install -g @openai/codex`) and `~/.codex` was left untouched: `config.toml`, `hooks.json` and every file under `agents/` are byte-identical before and after. Schema probes ran against a throwaway `CODEX_HOME` under the scratchpad rather than the real one.

Every row below was read from the tool, at both versions, and the 0.146.0 column is what the port is now built on:

| Fact | At 0.140.0 | At 0.146.0 | Consequence for the port |
|---|---|---|---|
| `plugin_hooks` | `removed` / false | `removed` / false | D9 stands: a plugin still cannot bundle hooks. |
| `hooks` | `stable` / true | `stable` / true | The user-level hooks mechanism the port targets is on by default. |
| `multi_agent` | `stable` / true | `stable` / true | D3 stands: judges can run as Codex subagents. |
| `multi_agent_v2` | `under development` / false | `stable` / **false** | Promoted to stable, still OFF by default. The port targets `multi_agent`; a v2 path now exists as an opt-in and is not adopted here. |
| `default_mode_request_user_input` | `under development` / false | `under development` / false | D10 stands: `request_user_input` is reachable only in Plan Mode. |
| `collaboration_modes` | `removed` / true | `removed` / true | Retired as a flag and forced on — no toggle to carry. |
| `non_prefixed_mcp_tool_names` | `under development` / false | `under development` / false | MCP tool names stay prefixed; every tool reference the port writes keeps its prefix. |
| `skill_mcp_dependency_install` | `stable` / true | `stable` / true | A skill may still declare an MCP dependency and have it installed. |
| `codex plugin` subcommands | `add`, `list`, `marketplace`, `remove` | identical | The install surface the port drives is unchanged. |
| `codex plugin marketplace` subcommands | `add`, `list`, `upgrade`, `remove` | identical | Marketplace wiring is unchanged. |
| `codex --help` top level | `exec`, `review`, `doctor`, `apply`, `resume` present | all five present | Every command the port invokes still exists. The one delta in the whole help output is the deprecated `on-failure` approval policy, now gone: the values are `untrusted`, `on-request`, `never`. |
| Plugin manifest keys | name, version, description, author, homepage, repository, license, keywords, `skills`, `apps`, `interface` — no `agents`, no `hooks` | identical across all three curated manifests | D9 stands from the artifact side too: there is nowhere in a manifest to point at hooks, and nowhere to ship agents. |
| Agent TOML keys in shipped files | `name`, `description`, `model`, `model_reasoning_effort`, `sandbox_mode`, `developer_instructions` | all six, plus `nickname_candidates` | Nothing the port writes is invalidated; `nickname_candidates` is optional. |
| Agent TOML tools allowlist | not checked | `tools` EXISTS, but as a table of per-tool toggles, and unknown keys inside it are tolerated | There is no allowlist to restrict a subagent's tools with. A judge that must not write is constrained by `sandbox_mode`, not by a tool list. |
| Agent TOML working directory | not checked | none — `cwd`, `working_directory` and `workdir` are all rejected | A Codex subagent cannot be pointed at a worktree through its role file. Whatever a parallel wave needs, it does not get from this key. |
| `[agents]` config keys | `max_threads = 4`, `max_depth = 2`, `job_max_runtime_seconds = 1800` | identical | The concurrency ceiling the port plans against is real and unchanged. |
| `[hooks.state]` trusted-hash key | positional, `"<hooks.json path>:<event>:<index>:<index>"` | identical | Trust is recorded per hook POSITION, so reordering `hooks.json` invalidates the recorded hash. |
| `shell_environment_policy.set` | assumed | present and proven | D2's mechanism holds. |
| `git rev-parse --git-common-dir` across worktrees | assumed stable | stable only under `--path-format=absolute` | D2's spelling must change; see the Decision. |

The agent role file is parsed with unknown fields REJECTED, which is what makes the two schema answers above decidable rather than inferred from what the shipped files happen to use: a key Codex does not know makes the whole role file fail to deserialize, and Codex reports it at startup as ``Ignoring malformed agent role definition: … unknown field `x` ``. Probing one candidate key at a time against a scratch `CODEX_HOME` is therefore a direct read of the schema. The same probe is what showed the file also accepts config-shaped keys — `instructions`, `approval_policy`, `model_provider`, `web_search`, `shell_environment_policy` among them — so a role file can carry its own environment policy.

`shell_environment_policy.set` was proven by running a command through Codex's own environment pipeline with the variable already exported in the parent: `codex sandbox -c shell_environment_policy.inherit=all -- sh -c 'echo $OSO_PROBE'` answered the inherited value, and the same command with `-c shell_environment_policy.set.OSO_PROBE=policy-wins` answered `policy-wins`. Upstream agrees on the ordering — `populate_env` inherits, filters, then inserts the `set` entries, then applies `include_only`.

The git finding is the one that arrived differently from how it was reasoned about. From the main checkout `--git-common-dir` answers the relative `.git`; from a linked worktree created under the scratchpad it answers `/…/oso-code/.git`, and from a subdirectory of that worktree the same absolute path. `--show-toplevel` answers a different path in each tree, which is exactly why it cannot be the identity. So the property D2 wants is real — one repository, one answer — but only the absolute form expresses it, and the bare form silently splits a single repo into two identities depending on which tree asked. Verified with git 2.55.0; `--path-format` has been available since git 2.31.
