# 0159 — The OpenCode adapter targets the OpenCode 2 plugin contract, and the pin moves to 2.2.6

Date: 2026-11-10
Status: accepted
Supersedes: the OpenCode 1 plugin surface every earlier OpenCode record describes — the `Plugin` factory and its hook map, the toast sink, the workspace adapter, the `@opencode-ai/plugin` external — and the 1.18.22 pin. The records stay as the history of what the OpenCode 1 host measured
Source: this change (opencode-v2-plugin-contract), slices 1 to 5; the measurements quoted below were taken on the real OpenCode 2.2.6 binary under an isolated `HOME` and the four `XDG_*` variables

## Decision

**OpenCode 2 only. `SUPPORTED_OPENCODE_VERSION` is 2.2.6, the version every certify suite of this change was driven against, and the installer refuses a host below it. The adapter is a default-exported `{ id, setup }` plugin, typed against `@opencode/plugin` with `import type` alone, with no runtime import of the host package.**

### What the OpenCode 2 contract changed, and how the adapter answers

- **Tools register directly.** `ctx.tool.transform` adds `{ name, input: <JSON schema>, description, options: { codemode: false }, execute(input, ctx) }` and the result is `{ content, metadata }`. `oso_wave`, `oso_plan_approve` and `oso_plan_cancel` are offered to the model under their bare names. `options.codemode: false` is what keeps a tool out from behind the host's `execute` tool.
- **Approval goes through `ctx.permission.assert`.** The approval tool asks for its own tool id as the action, patterned on the plan document's digest, linked to the call by `source: { type: "tool", messageID, id }`, and records the approval only once the assertion resolves.
- **Gates throw from `ctx.tool.hook("execute.before")`**, verdict capture reads `execute.after`, and the identity variables ride `ctx.shell.hook("create.before")`. Idle continuation is the `experimental.idle` session hook, system advice the `context` hook on primary requests, the re-anchor the `compaction` hook, and one event subscription feeds the continuation rail. `setup` returns the single Cleanup that closes the subscription, releases held runs and sweeps stale worktrees.
- **The toast sink and the workspace adapter are removed.** Neither was ever invoked on a path that reached the operator, and notices stay in state and in the log.
- **Each tool call acts on the directory of its own session record**, read through `ctx.session.get`, never on the plugin process's directory.

### The version probe

`opencode --version` on the OpenCode 2 host prints `opencode v2.2.6`. The probe's line shape accepts that line and the bare dotted version the OpenCode 1 host printed, so an OpenCode 1 host reads as 1.x and is refused by the floor rather than misread. `opencode run` on the OpenCode 2 host rejects `--dir`, so the certify drivers run in the project as their working directory with `PWD` set to it.

### The load proof, and the verify row

The plugin-load proof runs `opencode debug agents --standalone --print-logs` with `HOME` and the four `XDG_*` variables isolated. Of the three probes weighed, only `debug agents` logged `loading plugin id=<path>/oso-code.js` in six of six runs; `plugin list` and `debug config` did so in two of six. A plugin the host rejects logs its loading line and then a `failed to load plugin` warning, and a setup that throws logs the same warning with the plugin id and no path. The proof is therefore the positive loading line for the bundle and zero `failed to load plugin` lines of any shape, and `core/src/install/opencode-load-proof.ts` holds that rule for both the certify suites and the verify row.

`oso verify --host opencode` gains the row `installed plugin loads on the host`. It runs that probe against the isolated fixture install, never the operator's own config, so it needs neither the real home nor a network. Where no `opencode` is on `PATH` the row is skipped by name and never passes silently.

### What the host does with the installed permission rules

The installer writes `permission.oso_plan_approve` and `permission.oso_plan_cancel` as `ask`. Driven on 2.2.6, with the real bundle and a scripted model calling `oso_plan_approve`:

- Under `ask`, one `evaluate` hook fires for the tool's own action with effect `ask`, and the host raises no second prompt of its own. Headless, the host answers `! permission requested: oso_plan_approve (<digest>); auto-rejecting`, the tool's `execute.after` reports `status: error` with `Permission.CorrectedError`, and the model receives `{"error":{"type":"permission.rejected","message":"This non-interactive run cannot ask the user for permission, so the request was rejected. Continue without this action."},"content":[]}`. The state reads `plan_approval=pending` with the digest captured and not approved.
- Under `deny`, the tool is not offered to the model at all: `oso_wave` is the only oso tool in the tool list and no `evaluate` fires.
- Under `allow`, and with no rule, the `evaluate` effect is `allow` and the tool runs to its result.

So the installed `ask` is the operator's gate and the tool needs no `options.permission` of its own. The permission semantics are unchanged by the port. What was not driven is an interactive grant, because every measurement here is headless.

## Consequences

- The OpenCode 1 certify suites — `opencode-contract-bar`, `opencode-behavior-bar`, `opencode-wave-runner-smoke` and `opencode-prompt-free-posture` — are no longer run by the nightly. Measured on 2.2.6, the contract bar's fixture rows fail because the host dropped the `opencode debug agent` and `opencode debug skill` subcommands they drive, and the OpenCode 1 plugin shapes they read are gone. They are kept as the record of what the OpenCode 1 host measured until a decision ports or removes them.
- The nightly drives the five `opencode-v2-*` suites against the pinned release asset, checksum-verified against the release's own `SHA256SUMS`, and keeps the rule that a missing binary is a not-run line named in the summary, never a pass.
- A host below 2.2.6 is refused at install and reported below the floor by verify, by the drift warning and by the certify lanes.
