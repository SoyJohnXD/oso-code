# Shared layer — Codex

Host binding for the shared concerns that bind no single wrapper: Codex's delegated-role map and completion handshake, `../front-surface.md`'s wiring, and `../reporting.md`'s delivery.

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

## Essential memory

This binding controls the neutral flows' semantic-memory operations on Codex. Only the parent may persist semantic memory through standard Engram MCP; native base instructions and compaction stay intact. A child must not write semantic memory through shell or CLI, including indirect wrappers, interpreters, executable substitutions, or direct storage writes. Custom roles disable the Engram server; a built-in or unknown child may use only the known read-only context, search, and get-observation MCP reads exposed by the gate.

Persist the approved bare ledger once before dependent action, with dated amendments for material changes. Keep durable preferences and non-obvious root causes or reusable discoveries under stable topic keys. Upsert the existing record rather than duplicating it; routine reads, retries and hypotheses need no save. Never automatically capture prompts, subagent reports or raw logs, or require a Key Learnings section.

Keep all six milestones and full operational evidence in the local journal and artifacts. After a closed slice or real blocker or park, read back the durable local transition before publishing one compact checkpoint. Include approval digest, base and head, slice position, verified source and environment fingerprints, evidence references, pending findings and NEXT. The index changes only active-change or status and points to the detailed plan; it does not duplicate slice position.

Local immutable approval, `current.md`, Git and runtime evidence remain authorization truth. Engram is semantic recovery. Before arming after resume or compaction, reconcile those local records with the saved ledger and checkpoint. A missing persist or disagreement is explicit incomplete recovery, never green. After local verification, repair a stale checkpoint with a dated superseding update; do not rewrite approval or delete history.

An unchanged compaction repeats no writes. A real handover or close persists unreconciled progress once, rather than duplicating a checkpoint into phase and session summaries. Material decisions still persist before action; there is no global call quota. Static delivery and fixture side effects do not prove model cadence or effective native child isolation.

## Model and effort policy

Codex custom agent files take precedence over explicit spawn values when they declare `model` or `model_reasoning_effort`. The applier and verifier files deliberately omit both fields, so this binding selects `model="gpt-5.6-luna"` with `reasoning_effort="max"` by default. For a delicate or highly specialized assignment, select `model="gpt-5.6-terra"` with `reasoning_effort="high"`; an escalated applier requires its independent verifier to use the same Terra/high tier. An explicit later operator chat choice supersedes these defaults when the host can honor it, but the verifier never runs below its applier's selected tier. Before each launch, announce the exact `model` and `reasoning_effort` selected. If Codex does not expose the requested selection or actual values, report the capability as unavailable and stop without fallback or a duplicate launch; static role configuration and documentation do not prove an authenticated model launch.

The separate `oso-debt-sweep` and `oso-security-reviewer` roles keep file-level `gpt-6-astra`/`low` judging pins. The `oso-integrator`, `oso-doubt-pass` and `oso-triage` roles retain their existing role-file choices. The profile records `codex=launch policy: default gpt-5.6-luna/max; escalation gpt-5.6-terra/high`, never a pinned-host claim.

The three operational roles carry their remaining contracts in their agent definitions. Give them the payload the neutral body names. Because a Codex role cannot set its working directory, every applier and verifier payload includes the absolute WORKTREE PATH and the ref coordinate the body names for that launch — SLICE START or WAVE START — and every integrator payload also includes the absolute main-checkout path beside the wave's branches and worktrees.

The four reviewer roles are thin fresh-context adapters over the installed skills. Before spawning one, resolve its Codex `SKILL.md` to an absolute path. Give the role that path as `SKILL PATH` and give the skill's normal invocation payload as `ARGUMENTS`. The reviewer reads the wrapper and every bound neutral and Codex reference file itself; the orchestrator never reads a delegated judgment inline and never substitutes a summary for those files.

## Completion handshake

Every delegated payload carries two transport fields beside its semantic assignment: `HANDOFF SLICE`, a safe identifier made only of letters, digits, `_` and `-`, and `HANDOFF ATTEMPT`, a positive integer incremented on every relaunch of that slice. It also tells the subagent to begin its final message with exactly one line in this form:

`oso-handoff: v=1 slice=<ID> attempt=<N>`

Replace `<ID>` and `<N>` with the two payload fields; angle brackets never reach the message. That line is a transport envelope outside the report shapes the role or judge declares. The exact report follows it, so the report's required terminal verdict remains the message's final line. Codex's user-level `SubagentStop` hook reads `last_assistant_message` outside the child's sandbox and atomically publishes a receipt containing the hook session as metadata plus the slice, attempt, agent id and agent type. The receipt never carries `verdict`, `status`, findings, report text or a second copy of the message.

Retain the canonical agent path returned by the native launch. Wait for that exact agent's current final message and require its first-line marker to match this slice and attempt; cached finals and earlier attempts do not count. From the source repository, run `oso-state handoff resolve-codex --agent-path <canonical> --slice <id> --attempt <n> --agent-type <role>` under the parent's actual current `CODEX_THREAD_ID`. Retain the returned UUID alongside the canonical path; if the launch also returned a UUID, they must agree. The resolver is read-only, binds native first-record parent/path/role/workspace to the current receipt and refuses missing or ambiguous identity within ten seconds. Never substitute `OSO_AGENT`, pick the newest rollout or invent a UUID.

Next run `oso-state handoff wait` with the exact slice, attempt, resolved UUID as `--agent-id`, agent type and `--timeout 10`, then `oso-state handoff consume` with those same four identity fields. Only successful wait followed by one-shot consume satisfies the FILE PRECONDITION for interpreting this final report. These commands use the current repository as their outer identity and need no `--session`. A timeout, mismatch, stale or replayed receipt blocks the flow; evaluate the delivered verifier report under its shared **Evidence and acceptance** contract.

The MESSAGE is always the verdict. The receipt proves only that the matching `SubagentStop` observed a complete message and that this caller consumed it once. Never derive pass, fail, blocked, done, clean or findings from the file, and never continue from a receipt when the returned message says otherwise.

## Correction and quiescence

This Codex binding overrides neutral fresh-applier relaunch wording only for one corrective followup to the same completed applier, with unchanged assignment, model, effective environment and frozen decisions. Retain UUID and canonical path, increment the handoff attempt, and repeat the complete handshake for its new final. If any reuse condition fails, or another correction is needed, use a fresh applier and a fresh independent judge after proving the old work quiescent. Keep existing correction and judge round counts; changing agents never resets a budget. Judges remain fresh, not corrective reuse targets.

Before launching source work, refuse background, detached or opaque-lineage commands. Source writers use native hookable tools, never scratch as a source-write route. Retain every owned native exec, process and service handle and reconcile each to an ended state before final, replacement, serialized green or commit. Tool exit, timeout, interrupt acknowledgement and a cached final alone do not prove that descendants or owned services ended. After interruption or compaction, unknown lineage or missing handles blocks replacement and commit until exact identity and completion evidence are recovered. Fresh or sequential fallback is safe only after that proof; otherwise report unavailable or blocked. This is orchestration discipline, not a new process manager or sandbox.

Executable receipt and metadata tests establish identity, bounds and replay refusal. Structural prose tests establish delivery only; model correction reuse and unsafe-replacement refusal require the separately budgeted native certification, not sentence presence.

## Command authoring

Use native hookable `apply_patch` for source edits. Run short, literal, foreground invocations of existing checks, separate from source edits, with the explicit WORKTREE PATH and the owned-handle completion discipline above. Avoid shell-embedded editing programs and unsupported wrapper-option introspection such as `command -v node`.

The production lexer bounds the whole invocation in UTF-8, including its lexer-owned LF: 3072 bytes permits at most 3071 raw bytes. Shorter syntax can still be unread; unread is not evidence of an observed deploy, though the conservative gate still refuses it. Native tools, short commands and existing checks are not blanket authorization; all existing gates and assignment permissions still apply.

On rejection, stop for diagnosis with the exact invocation and denial evidence. Never split, encode, create wrappers or scripts, retry through alternative tools, or change AUTO or permissions to get the rejected operation through. Missing original bytes leave incident-specific length attribution unproven.

## Owned verification scratch

Use `oso-state scratch create/run/close/recover` for reviewed Linux foreground checks that need an independent export, not a hand-built archive or a copy into a shared cache. This is process-group lifecycle discipline, not an OS sandbox or containment for arbitrary daemons. The complete test suite and native certification use the existing no-export sequential route: scratch lifecycle tests start their own sessions, so nesting them would violate supervision. Unsupported platforms, tools, lifecycle/install scripts and uncertain filesystem capacity also retain that route; a refusal never waives a prescribed check.

The caller reviews the complete transitive command/input/dependency/cache inventory before declaring `foreground: true`. Source files are copied independently; list exclusions explicitly, including secrets, `.git`, dependency workspace links and `node_modules/.bin`. Symlinks, case aliases, hardlinked source files and special files are refused rather than followed. Declare full build-output headroom; admission also reserves logical input bytes, parent-directory inodes, concurrent attempts, 2 GiB and 100000 free inodes. Unknown filesystem capacity is a refusal, including unavailable Btrfs inode reporting.

A recipe is a source-relative JSON file with this shape; replace the executable and headroom with reviewed project values:

```json
{
  "version": 1,
  "foreground": true,
  "cacheRouting": "node-only",
  "source": ["check.mjs"],
  "dependencies": [],
  "exclusions": [".git", ".env", "node_modules/.bin"],
  "headroomBytes": 1048576,
  "headroomInodes": 100,
  "commands": [{"purpose": "check", "argv": ["/usr/bin/node", "check.mjs"]}]
}
```

`node-only` accepts the current Node executable plus one inventoried script, with supported built-in imports and no opaque/dynamic process nesting. For this repository's exact `npm run build`, `npm run check` or `npm run typecheck`, use `cacheRouting: "node-npm"`, literal argv such as `["npm", "run", "build"]`, and `tools: ["node", "npm", "sh", "esbuild"]` for build/check or `["node", "npm", "sh", "typescript"]` for typecheck. Inventory the relevant builder sources and their imported modules, manifests, configurations, generated inputs, and installed platform dependencies; exclude unsupported links rather than copying all of `node_modules`. Npm's Node CLI and shell are inventoried external runtimes, used read-only; esbuild's pipe-bound service and TypeScript's platform executable remain in the owned session. Missing dependencies fail the check; scratch never installs them or substitutes filtered tests.

Run creation from the source worktree, with a private random owner token of 24–128 URL-safe characters and the run/assignment/role coordinates. `--attempt` identifies this verification attempt, not the handoff receipt attempt; the persisted scratch ordinal increments independently across recreated materializations. Keep the opaque ID returned by create and the owner token for cleanup, never a caller-supplied deletion path:

```text
oso-state scratch create --owner <token> --run <run> --assignment <slice> --role verifier --attempt <verification-attempt> --recipe <relative-json>
oso-state scratch run --id <id> --owner <token> --purpose check --timeout 60 -- /usr/bin/node check.mjs
oso-state scratch close --id <id> --owner <token>
oso-state scratch recover --id <id> --owner <token>
```

Close in the caller's `finally` before reporting success; a passed command leaves its payload ready for the remaining reviewed checks, while failure/cancel/timeout closes it after quiescence. Run applies the source repository's current pending/edit/commit/production gates to the exact literal inner argv even when called from the payload. Actual HOME, CODEX_HOME, XDG homes, temporary directories and npm config/cache are private payload paths; unsafe inherited runtime settings are refused, and unlisted environment variables are not inherited.

Timeouts are bounded to 3600 seconds; combined raw output is capped at 16 MiB per attempt, with overflow terminating the command and retaining incomplete evidence. Explicit lifecycle operations expire only this owner's closed raw logs after seven days while keeping compact identity, commands, exits, source/dependency/exclusion inventory, verdict and cleanup evidence. Recovery requires the exact owner and inactive tracked identities/session, never age or process names; a violated recipe, missing identity or uncertain cleanup blocks allocations and success for operator reconciliation. Active or foreign siblings, the source worktree and shared caches are never purge targets.

## Readiness and freshness

A slice is ready for verification when its own handshake is consumed and its owned handles are reconciled under **Completion handshake** and **Correction and quiescence** above. A ready, isolated and quiescent slice may be verified while unrelated wave work is still in flight, inside the wave's existing dependency and isolation barriers and never in place of them. Codex owns its own subagent threads and this harness rations none of them: it reserves no slot, certifies no released capacity, and a spawn this host refuses is an ordinary tool-call error to report, never a park, a stop or a reduced check.

Default to one heavy suite or scratch materialization at a time. Concurrent checks require proven port, cache, output and environment isolation for every runner involved. Unproven isolation or an unavailable capability takes the existing sequential no-export route above once quiescence is proven, never a reduced check.

Use the shared verifier contract's **Evidence and acceptance** freshness binding for every report, no-export runs included. Reconcile that binding again before the commit window; any affected evidence must be current before green or commit.

Every source writer and owned process of the slice has ended before a serialized green or commit window opens. The full bar still runs on the actual assembled tree at the integration gate; earlier slice greens never stand in for it.

## Strict closure

This policy governs Codex plan, roadmap, quick and debug closure and their debt-sweep judges. It replaces the neutral severity-band exit, settled-tag immunity and optional or skipped conformance rules, not the rubric or the mode's other gates.

Require zero introduced or aggravated scoped debt, including nits, and clean exact-scope conformance. Only `Debt Sweep: clean` together with `Conformance: clean` permits the debt/scope gate to pass. An open nit, unconfirmed fix, missing or extra scope, or missing or skipped conformance blocks green and close. Pre-existing untouched debt remains outside the rubric's change boundary.

Plan and roadmap supply the bare frozen ledger and scope, including approved amendments, with the existing CHANGE BASE. Quick and debug must invoke a fresh final `oso-debt-sweep` judge. Their ARGUMENTS carry CLOSURE BASIS = approved micro-intent or diagnosis plus scope, with the existing base coordinate and complete changed-file scope, including staged, unstaged and untracked changes. Quick uses the pending tree; debug retains `HEAD` on every invocation. Never invent a ledger for either mode. A missing closure basis blocks the judge with `Debt Sweep: blocked`; it never falls through to a skipped conformance axis. Quick stays inline, without a plan or slices, and retains its inline quality pass.

The judge checks the supplied basis for unimplemented, contradicts-decision, scope-creep and partial gaps, using the existing conformance report and file evidence. For quick/debug, label that separate section **Scope conformance** and interpret decision references as approved intent or diagnosis items. Every changed item must trace to the supplied scope and every required item must be implemented. Preserve the full rubric, severity tiers, evidence and separate debt and conformance verdicts.

On every confirming invocation, pass all prior findings with bare dispositions, the same base and the current approved basis and scope. The fresh judge must independently recheck each original finding claimed `fixed` against the current tree and report the original file:line with observed resolution evidence or keep it open. Neither `operator-dismissed` nor `accepted-residual` hides debt or a scope gap that still exists; report its evidence and keep the gate red.

Route debt fixes through the existing cleanup assignment and conformance fixes through the mode's approved implementation path; quick implements inline. Unanswered scope or contract questions stop for the operator, never authorize extra work. Every source correction invalidates affected green flags and checks, including changes from quality, design or security review. Re-arm the mode's existing red state before editing, then require post-fix verification and a fresh debt/conformance confirmation on the corrected tree before green or close. Rerun affected independent verification and other judges as well as the zero-warnings bar.

Keep existing loop caps and round counts. Never reset a counter by changing the finding's tag, reopening a loop or routing its remainder elsewhere. At a cap, stop red for the operator's explicit further-round grant or approved follow-up work; a residual waiver never authorizes green or close. Roadmap may set the child aside under its approved policy, never mark that child successfully closed. This gate adds no milestone and replaces none of the six reporting milestones.

## Front-surface binding

- The mode labels are the bare `plan`, `quick` and `debug` skills.
- The stable Impeccable skill is `~/.agents/skills/impeccable/SKILL.md`, materialized inside its user-wide root as a real, symlink-free copy by the installer and never used through its source plugin-cache path. When a shell or payload needs the expanded spelling, use the absolute `$HOME/.agents/skills/impeccable/SKILL.md`.
- Invoke the mounted skill as `$impeccable <argument>`: `$impeccable init`, `$impeccable document` and `$impeccable audit <touched surfaces>` are the three routes. The words are explicit arguments to the one skill, never standalone skill names or Claude slash commands.
- For a harness-owned invocation, read the mounted `SKILL.md` completely, pass the exact ARGUMENT `init`, `document` or `audit <touched surfaces>`, then load and follow the command's mounted reference. Do not approximate an argument from memory or treat reading only `reference/` as loading the skill.
- The filesystem payload to an applier uses that absolute `SKILL.md` plus its `reference/` directory, also expanded below `$HOME/.agents/skills/impeccable/`. The applier reads those files; it does not invoke the skill and is never handed the source cache path.
- Record the independent installed-skill numeral from the `version:` field in the mounted `SKILL.md`. Never inspect the source cache merely to obtain the mounted version.
- Route design findings to the `oso-applier` subagent in fresh context through the **Delegated roles** and **Completion handshake** sections above.
- When Impeccable is absent, ask the operator to rerun `node bootstrap/oso.js install --host codex`. That install does not mount Impeccable itself; never repeat Claude's `/plugin` commands and never use a discovered cache path as a temporary mount.

## No card exists here

This host draws no card for a spawned role or a waited-on handoff: the **Delegated roles** and **Completion handshake** sections above are transport, invisible to the operator unless the milestone text itself says what happened. The contract at `../reporting.md` is therefore this host's WHOLE visibility layer, not a complement to a native affordance.

## The delivery contract

Routine informational milestones may continue in the same turn with the tool call that advances the flow; questions, permission requests, operator-dependent blockers and completion remain turn boundaries. Native approvals remain genuine operator grants and exact-document gates. Claude Code's unattended carve-out and OpenCode's continuation rail do not change those Codex boundaries, and this host has no runtime rail that fabricates a later approval or operator decision.
