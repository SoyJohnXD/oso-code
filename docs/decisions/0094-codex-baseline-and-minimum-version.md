# 0094 — The verified Codex baseline, and the minimum version the harness supports

Date: 2026-08-02
Status: accepted
Reconciled: applied — tests hold the floor; the lifecycle handlers, atomic state transitions, pending-tool deny, rendered manifest and published trust ledger implement the corrected approval rail; the installer pins 0.146.0 and the post-install verifier checks that exact version.
Source: this change (Codex port), ledger decision D14; recorded with the change that made it

## Decision

Minimum supported Codex: 0.146.0

The number is a floor, not a range. Every fact this port rests on was read out of a 0.146.0 CLI on 2026-08-02 by running the tool, and nothing below that version has been checked since the port was designed. Ledger D14 has the installer PIN this version rather than `@latest`, so the pin and this line move together: a Codex release that moves a load-bearing flag is a new decision here first and a new number second, never a silent `@latest` that changes the harness under the operator.

**Correction, 2026-08-03; amended 2026-08-04 by ADR-0101.** The first probe treated `request_user_input` availability as the whole D10 surface and missed the lifecycle events that can enforce the answer. Codex 0.146.0 exposes `Stop` with `last_assistant_message` and `permission_mode`, plus `UserPromptSubmit` with the pending `prompt` and `permission_mode`; the latter can block before the prompt reaches the model. D10's claim that no hook can observe approval is therefore superseded. Slice S7 first bound a custom token; the live client then established the better composition: `Stop` binds the presented plan and artifacts, native approval submits `Implement the plan.` in Default mode, `UserPromptSubmit` consumes it only for the matching pending digest, and `PreToolUse` keeps local tools closed in between.

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
| `default_mode_request_user_input` | `under development` / false | `under development` / false | Question rounds still belong to Plan Mode. This flag says nothing about approval-token observability; the lifecycle-hook row below corrects that earlier inference. |
| `Stop` + `UserPromptSubmit` hook schemas | not checked | `Stop` carries `last_assistant_message` + `permission_mode`; `UserPromptSubmit` carries `prompt` + `permission_mode` and can block | D10 is repaired: a host hook can bind the delivered plan, reject a token in Plan Mode and approve the exact prompt before the model turn. |
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

The approval correction was checked three ways at the declared floor: the installed 0.146.0 binary contains the release's `user_prompt_submit` event implementation; the official `rust-v0.146.0` source serializes both `prompt` and `permission_mode` and honors `decision: block`; and a scratch-home `codex exec --dangerously-bypass-hook-trust` probe ran a `UserPromptSubmit` command hook and stopped the prompt before authentication. The live payload carried the documented fields. This is stronger evidence than the missing feature-flag inference it replaces.

`shell_environment_policy.set` was proven by running a command through Codex's own environment pipeline with the variable already exported in the parent: `codex sandbox -c shell_environment_policy.inherit=all -- sh -c 'echo $OSO_PROBE'` answered the inherited value, and the same command with `-c shell_environment_policy.set.OSO_PROBE=policy-wins` answered `policy-wins`. Upstream agrees on the ordering — `populate_env` inherits, filters, then inserts the `set` entries, then applies `include_only`.

The git finding is the one that arrived differently from how it was reasoned about. From the main checkout `--git-common-dir` answers the relative `.git`; from a linked worktree created under the scratchpad it answers `/…/oso-code/.git`, and from a subdirectory of that worktree the same absolute path. `--show-toplevel` answers a different path in each tree, which is exactly why it cannot be the identity. So the property D2 wants is real — one repository, one answer — but only the absolute form expresses it, and the bare form silently splits a single repo into two identities depending on which tree asked. Verified with git 2.55.0; `--path-format` has been available since git 2.31.

## Amendment, 2026-09-09 — re-measured against codex-cli 0.153.2

Ledger #4135 D4 re-ran the probes above against the installed `codex-cli 0.153.2` (`/home/tribalcode/.local/share/mise/installs/codex/0.153.2/bin/codex`, released 2026-09-03) and D5 raised `SUPPORTED_CODEX_VERSION` to it. The historical 0.140.0 and 0.146.0 columns above are untouched; this section records only what 0.153.2 answered. Every probe ran read-only against a disposable `CODEX_HOME` under the scratchpad, never the operator's `~/.codex`, and `--version`, `--help`, `features list`, `doctor`, `-c` schema probes, `sandbox` and `rg --text` over the binary were the only surfaces used.

The `[agents]` row is the one that moved, and it is why D3 has the installer stop writing that table at all:

| Fact | At 0.146.0 | At 0.153.2 | How it was measured |
|---|---|---|---|
| `[agents]` key set | `max_threads`, `max_depth`, `job_max_runtime_seconds` | `max_concurrent_threads_per_session`, `max_depth`, `job_max_runtime_seconds`, `enabled`, `default_subagent_model`, `default_subagent_reasoning_effort`, `interrupt_message` | `codex -c 'agents.<key>="notanint"' features list` reports the field and its Rust type |
| `max_threads` | a field of its own | an ALIAS: `-c 'agents.max_threads="notanint"'` answers ``invalid type: string "notanint", expected usize in `agents.max_concurrent_threads_per_session` `` | the same type probe, which names the field the alias resolves to |
| `max_depth` | a concurrency ceiling the port planned against | still `i32`, and the binary's own agents renderer annotates it `(V1 only; ignored by V2)` | type probe plus `rg --text` over the binary |
| `job_max_runtime_seconds` | present | present, `u64` | type probe |
| unknown key under `[agents]` | not checked | absorbed as a NAMED ROLE POINTER, not rejected: `-c 'agents.bogus=1'` answers ``invalid type: integer `1`, expected struct AgentRoleToml``, and `-c 'agents.bogus={}'` is accepted | the same probe with a table value |
| DEFAULT values of the three keys | `4`, `2`, `1800` | NOT MEASURED | no read-only surface on this host prints the effective `[agents]` table: `doctor --all` omits the section, the app-server JSON-Schema bundle carries none of the keys, the package ships no docs, and the renderer that would print them (`  - max_concurrent_threads_per_session = …`) lives in the TUI, which needs an authenticated interactive session |
| `--ask-for-approval` values | `untrusted`, `on-request`, `never` | `on-request`, `never` — `untrusted` is gone | `codex --help`; no harness file names `untrusted`, so nothing in the port moves with it |
| all eight feature flags of the table above | as recorded | IDENTICAL, state and default alike | `codex features list` (135 flags) |
| `Stop` hook schema | `last_assistant_message` + `permission_mode` | identical, plus `turn_id`, `transcript_path` and `stop_hook_active`, and `permission_mode` now enumerates `default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions` | the `stop.command.input` JSON Schema embedded in the binary |
| `UserPromptSubmit` hook schema | `prompt` + `permission_mode`, can block | identical, plus `turn_id` and the same five-value `permission_mode` enum, `decision: block` retained | the `user-prompt-submit.command.input`/`.output` schemas embedded in the binary |
| `codex plugin` subcommands | `add`, `list`, `marketplace`, `remove` | identical | `--help` |
| `codex plugin marketplace` subcommands | `add`, `list`, `upgrade`, `remove` | identical | `--help` |
| `codex --help` top level | `exec`, `review`, `doctor`, `apply`, `resume` present | all five present, beside new `agents`, `queue`, `fork`, `archive` and `migrate-rollouts` commands the port drives none of | `--help` |
| `[hooks.state]` trusted-hash key | positional | the `hooks.state."…".trusted_hash` key path and the `HookStateToml { enabled, trusted_hash }` struct are both still in the binary | `rg --text` over the binary |
| `shell_environment_policy.set` | proven | proven again: `codex sandbox -c shell_environment_policy.inherit=all -- sh -c 'echo $OSO_PROBE'` answered the inherited value and the same run with `-c shell_environment_policy.set.OSO_PROBE=policy-wins` answered `policy-wins` | run against the disposable home |
| `git rev-parse --path-format=absolute --git-common-dir` | stable only in the absolute form | unchanged under git 2.55.0: the bare form still answers `.git`, the absolute form the repository path | run in this checkout |
| Plugin manifest keys | no `agents`, no `hooks` | NOT MEASURED | re-reading the three curated manifests needs a marketplace fetch, and no probe here is allowed to reach the network |
| Agent ROLE FILE schema (`tools` table, rejected `cwd`/`working_directory`/`workdir`, unknown-field rejection) | measured at 0.146.0 | NOT MEASURED | `-c agents.<name>.<key>` resolves to the INLINE `AgentRoleToml` pointer struct (`description`, `config_file`, `nickname_candidates`), which tolerates unknown keys, so it decides nothing about the role FILE. The strict file loader still exists — `Ignoring malformed agent role definition: ` is in the 0.153.2 binary — but it only runs inside an authenticated session |

The `[agents]` finding is what the installer acts on. Writing `max_threads = 4` at 0.153.2 does not set the key 0094 recorded; it sets `max_concurrent_threads_per_session` through an alias, capping the operator's own subagent concurrency at a number this harness chose for a different release. Codex manages its subagent children itself, so D3 retires that write entirely: oso-code renders no `[agents]` block, releases the key from `OSO_OWNED_CONFIG_PATHS`, and reports an operator's own block as a non-blocking notice instead of refusing an install over it.
