# oso-code

Team harness for Claude Code and Codex. A guided orchestrator that keeps the human in charge of decisions, delegates implementation and independent verification, and closes every change against explicit quality gates.

## What it is

- **Plan** — `/oso-code:plan` on Claude Code or native `/plan` followed by `$oso-code:plan` on Codex: intent → surface mapping → decision rounds → slices, then an apply/verify loop per slice with a zero-warnings bar. How that loop runs is a choice you make at slicing time, on the widest wave's width: sequentially in the main checkout, or wave by wave in parallel, one worktree per slice, each wave merged by a dedicated integrator and re-verified as a whole before the next one starts. When that choice is structurally unavailable, the approval document says why instead of silently omitting it, and accounts for every conditional planning phase. Codex uses its native `Implement the plan.` approval interaction; Oso binds that prompt to the exact pending document rather than asking for a second harness token.
- **Quick** — `/oso-code:quick` on Claude Code or `$oso-code:quick` on Codex: micro-intent, rapid inline iteration, then a quality pass.
- **Debug** — `/oso-code:debug` on Claude Code or `$oso-code:debug` on Codex: reproduce-first triage (reproduce → localize → reduce), then a delegated fix plus a regression test through the same apply/verify loop.
- **Debt-sweep** — closing phase of `/plan`, and offered on a `/debug` fix that sprawled across many files: judges code debt (dead code, duplication, stray comments, rubric violations — powered by fallow) and, on `/plan` changes, ledger conformance against the frozen decisions, then applies readability-only fixes. Never functional changes.
- **Design bar** — any change that touches front surface (UI files, component directories, or a visibly rendered outcome) runs against the project's `DESIGN.md`/`PRODUCT.md` with the [Impeccable](https://github.com/pbakaus/impeccable) plugin: a pinned `impeccable detect` in the verify bar — the pin resolved from the npm CLI, whose release line is independent of the plugin's — and an audit → fix → re-audit loop at close on `/plan` and `/quick`.
- **Security pass** — offered before any commit on a change touching auth, payments, or data models: on acceptance the host-native reviewer (`security-review` on Claude Code, `codex review` on Codex) examines the pending diff, and the findings you accept loop through fix → re-review until clean or you accept the residual.

## Repository layout

| Path | Purpose |
|---|---|
| `plugin/` | The Claude Code plugin the team installs: skills (slash commands), hooks, and the `oso-state` helper. Each skill is a thin wrapper over a platform-neutral body in `plugin/skills/_shared/bodies/` plus a host file in `plugin/skills/_shared/platform/claude/`, so a rule that governs both hosts is written once. |
| `codex/` | The Codex plugin: thin skill wrappers over the same neutral bodies. Codex host bindings live under `plugin/skills/_shared/platform/codex/`; hooks and agent roles are installed as user-level artifacts because the plugin schema cannot bundle them. What the hosts do not share is listed in [docs/parity-codex.md](docs/parity-codex.md). |
| `bootstrap/` | Host installers, post-install verifiers, the release-published hook hashes, and the separate transactional Codex purge/restore utility. |
| `docs/` | Design documents. Start with [docs/blueprint.md](docs/blueprint.md) for the current design, then [docs/decisions/](docs/decisions/) for the numbered decisions behind it — the blueprint's own index lists them by date. |
| `tests/` | Hook regression suite (`tests/hooks-test.sh`) and the plugin linter (`tests/plugin-lint.sh` — every forked skill declares `background`, every forked skill declares an `end with exactly one of:` verdict block, every `oso-code:<name>` reference resolves to a real skill or agent, every call site of a skill or agent that declares such a block carries every token of an axis it engages, each paired with a recovery verb rather than merely named, and the skipped verdict of any axis whose other verdicts it reads, `security-pass` never acquires its diff from a remote-qualified ref, the Impeccable detect gate never carries a placeholder where its pin belongs, each host's always-loaded global source (`bootstrap/claude-global.md` and `bootstrap/codex-global.md`) routes to every mode the model cannot invoke on its own, every line that launches `oso-verifier` names the payload it hands it, every line that launches `oso-integrator` names the wave's worktrees, WAVE START and branch list, every `plan`-skill line that launches an applier or verifier names SLICE START or WAVE START by name (a debt-cleanup or judge-findings launch exempted, since neither ever carries one), `oso-integrator`'s report on both hosts names `next_wave_start` as WAVE START's only producer and states that a conflict or a blocked report yields none, `triage`'s one question, its comparison-coordinate bullet and its pre-existing verdict all name WAVE START — the bullet disambiguating it from CHANGE BASE on the same line, every decision under [docs/decisions/](docs/decisions/) says where it landed, the blueprint's own decision index names every file docs/decisions/ holds, every decision a skill cites resolves to one of those files and is named back by it, the prose that counts these rules names the number the linter declares, both hook manifests plus every release-published hook hash exactly match their single source, the milestone reporting contract at `plugin/skills/_shared/reporting.md` names every required fact of its five milestones plus a length bound and every flow body that arms a slice or launches a delegation points at it, the Claude-card/Codex-no-card difference that contract defers to a host lives in exactly one platform file per host, the design-foundation slice paragraph names what `init` and `document` each produce and requires reading and recording the installed Impeccable version before the slice is cut, the Codex harness-discovered-correction amendment lane asserts all four of its conditions — an unstarted slice, a cited file and line, one operator confirmation, and a recorded amendment — and the Wave 0 bullet and the Cut-one-worktree-per-slice paragraph never go back to contradicting each other over wave 1's own WAVE START — twenty-two rules `claude plugin validate` has no opinion on, though it does read the manifest, `hooks.json`, skill frontmatter and the agents). Run both plus `claude plugin validate --strict plugin` and `claude plugin validate --strict .` — the plugin manifest and the marketplace one — before any release; the suite runs the linter as one of its own cases, so every CI run gates these rules wherever it runs the suite — ubuntu, the `bash:3.2` container, Windows — and validates both manifests besides. |

## Install

Clone once, then run the path for your host:

```bash
git clone https://github.com/SoyJohnXD/oso-code
cd oso-code
```

### Claude Code

Prerequisites per OS — the bootstrap checks and guides you, but know what you need:

| OS | Required | Notes |
|---|---|---|
| Linux | git, [Claude Code](https://code.claude.com), Node.js | jq auto-installs via your package manager |
| macOS | git, Claude Code, Node.js | jq auto-installs via Homebrew |
| Windows | nothing pre-installed — just double-click `bootstrap\install.bat` | it provisions Git for Windows, Node.js, and jq via winget — Claude Code through its own official installer — then runs the installer under Git Bash |

No OS needs a Rust toolchain: the installer provisions the fallow analyzer itself on Linux, macOS and Windows from its npm package, pinned to `3.14.0`, which ships prebuilt binaries for all three. The only prerequisite that costs is Node.js, already in the table above — and `verify.sh` counts fallow as a check like the other MCPs rather than reporting it.

```bash
bash bootstrap/install.sh     # prerequisites, MCPs, plugins, legacy cleanup (asks before anything destructive)
bash bootstrap/verify.sh      # measurable post-install E2E — every check ok:, ending on failed: 0
```

`verify.sh` prints one line per check, `ok:` or `FAIL:`, and closes with `passed: N, failed: M` — the run is green when `failed: 0`, which is also its exit status. A `note:` line is not a check and moves neither number: notes are where the optional pieces and your own choices get reported (an `--no-impeccable` opt-out; no jq to read the install record; a repo whose `core.hooksPath` belongs to another tool; and, off Windows, the home dir the Windows client reads, since there is no `%USERPROFILE%` there to disagree with `$HOME`). So a green run is every `ok:` plus whatever notes describe your machine.

Installing fallow by hand, if you ever need to — `bash bootstrap/install.sh` runs both steps for you:

```bash
npm install --global fallow@3.14.0
claude mcp add --scope user fallow -- fallow-mcp
```

On Windows, point that second command at the shim npm actually writes, `%APPDATA%\npm\fallow-mcp.cmd`: the extensionless file beside it is a shell script for Git Bash, and the Claude Code client is a native Windows process that cannot spawn it. Building the server yourself with `cargo install fallow-mcp` still works as an alternative; nothing here requires it.

The installer also installs the Impeccable plugin (the design bar) by default — pass `--no-impeccable` (`-NoImpeccable` on `install.ps1`) to skip it. That choice is recorded as a marker file the installer writes and clears, and `verify.sh` reads it: the plugin check becomes a `note:` naming the opt-out instead of running, so the verification still ends at `failed: 0`. Its second impeccable check stays green either way: `npx` fetches the CLI from the public registry rather than from the plugin install. That check runs the unpinned name, so it answers whether `npx` can fetch and run impeccable at all — not whether the version the `detect` gate pins resolves.

**Windows**: no terminal needed — clone the repo, then double-click `bootstrap\install.bat`. It provisions Git for Windows, Node.js, and jq via winget, installs Claude Code through its own official installer, then delegates to the same `install.sh` under Git Bash. Prefer a terminal? Run `powershell -ExecutionPolicy Bypass -File bootstrap\install.ps1`. Fallback, if you already have Git Bash and the prerequisites: run `bash bootstrap/install.sh` directly inside Git Bash.

Then restart Claude Code.

### Codex

The Codex path requires git, Node.js/npm, and the Codex CLI already installed at the exact verified floor — `0.146.0`, never `@latest`. The installer no longer installs or upgrades that CLI itself: it refuses to run against any other installed version, naming `npm install --global @openai/codex@0.146.0` as the command to run first, because an in-place CLI upgrade run ahead of its own transaction is a mutation nothing in that transaction could later roll back (ADR-0125). Once the pin holds, it transactionally installs the plugin, rendered user hooks, seven agent roles, bounded `config.toml` ownership blocks, MCP wiring, git gate, and the Impeccable skill mounted at a pinned Git tag. It preserves personal `[projects.*]` configuration and unrelated keys in shared tables such as `[features]`, and backs up every artifact it replaces. Reinstall also composes Engram's root instruction pointers with Oso's region and repairs only an exact clean official Engram marketplace cache that Codex left unregistered; modified, symlinked or unknown cache state is preserved and refused (ADR-0102).

Every run's own `install-backup-*` snapshot under `~/.local/state/oso-code` — separate from the one-time purge/restore below — restores with `bash bootstrap/restore-codex.sh [--list] [--yes] [<backup-name>]`, reading each target from that backup's own manifest so an older or newer release's backup still restores; `core.hooksPath` is the one thing it cannot revert, since that value only ever lived in the installing run's own memory. Retention that prunes these snapshots by total size stays off on a machine that has never run a restore, and turns on only once one has (ADR-0124).

```bash
npm install --global @openai/codex@0.146.0   # only if not already at this exact version
bash bootstrap/install-codex.sh
codex login                       # first install only; skip when already authenticated
# Start a new Codex thread, open /hooks, and review/trust the installed hooks.
bash bootstrap/verify-codex.sh
```

Until the `/hooks` review is complete the files are installed but their runtime rail is not enforcing. `verify-codex.sh` checks the complete local install and finishes with `passed: N, failed: M`. Its authenticated `codex exec` integrator/delegation smoke is intentionally local: CI uses fixtures and never logs in or executes a real Codex session. The smoke launches Codex against its own disposable `CODEX_HOME`, never the operator's real one — Codex writes an unconditional project-trust table for the disposable repository that no CLI flag can suppress, so isolating the home is what keeps that write off the operator's real `config.toml` instead of cleaning it up afterward. The smoke grants that isolated parent the integrator's `danger-full-access` because Codex propagates live parent sandbox overrides to children, launches the explicit role with fresh context, and requires the delegated merge and teardown as observable Git effects plus a spawn/wait/consume correlation on one Codex-assigned agent id inside a temporary repository (ADR-0123).

If you are migrating a pre-release Gentle/Oso Codex setup, the optional one-time full reset is deliberately separate from installation. Read [the purge and restore procedure](docs/codex-purge-and-restore.md) before running it; it backs up complete `~/.codex` and `~/.agents` trees with verified hashes and can restore them without overwriting existing roots. A machine already reset, reinstalled, and logged in should skip both purge and login: run the oso installer, trust its hooks, then run the verifier.

Daily use:

- Claude Code: `/oso-code:plan`, `/oso-code:quick`, `/oso-code:debug`; optionally `/output-style Oso`.
- Codex: enter `/plan` (or Shift+Tab) before `$oso-code:plan`; `$oso-code:quick` and `$oso-code:debug` start from the normal mode.

The installed `oso` permission profile — the wider `.git` write, workspace roots and network reach the harness needs for its own commits, worktrees and delegated roles — is the machine default for every Codex session (ADR-0121, ADR-0122): the installed binary offers no per-project profile selection, so scoping it any narrower would mean typing a flag on every launch with no escape. `.git/config` stays read-only, the extended secret denylist and the cloud-metadata network denies still apply regardless of scope (ADR-0121) — this is a discipline rail, not a lock, the same framing the runtime gates below carry.

Updating later follows the route for the host and artifact tier that changed:

- `claude plugin update oso-code@oso-code` updates the plugin. The marketplace entry's source is `./plugin`, so that subtree is the whole payload — skills, agents, hooks, git-hooks, `oso-state`, the output style, and the `.mcp.json` that carries context7 — and it works from a marketplace install, with no working copy of this repo at all.
- Codex releases are re-applied with `bash bootstrap/install-codex.sh`: its plugin carries skills only, while the installer owns the user hooks, agents, bounded config blocks, MCPs, runtime and git gate around it.
- When a release's entry in [CHANGELOG.md](CHANGELOG.md) is marked **Reinstall required**, `bootstrap/` changed and a plugin-only update cannot carry the complete release: pull the repo and re-run the installer for your host.

**Surfaces**: oso-code is installed and verified against the local Claude Code and Codex runtimes. Codex's native approval UI submits `Implement the plan.`; Oso's guarantee composes that interaction with its local `Stop` → `UserPromptSubmit` → `PreToolUse` digest path. Codex 0.146 misreports Plan turns as `permission_mode=default`, so Oso attests native mode against the exact hook turn before that path can capture, revise or approve a document. The common prompt is intercepted only for a same-session pending Oso document. Hosted or specialized execution surfaces, and `write_stdin` calls against an already-running process, do not cross that complete rail.

## Runtime gates

Once the host has loaded and, on Codex, trusted them, the hooks DENY tool calls — that is the enforcement, not a warning:

- A `git commit` is denied while the repository's active harness state is not green. Two layers read the same flag: the git `pre-commit` hook the installer wires through `core.hooksPath` is the primary one — it sits at the commit's own boundary, so aliases, wrappers, and an absolute `/usr/bin/git` all reach it — and the `PreToolUse` Bash matcher covers what a git hook never sees. `core.hooksPath` is a per-repo setting: the installer wires the repo you install from, migrates an exact earlier oso-code checkout path only when it contains no sibling, and prints the one-line `git config` for any other repo; the matcher applies everywhere regardless. `git commit --no-verify` skips the git layer by git's own design; the matcher is what catches that shape.
- A plan slice commits as it goes green, in both modes: a commit is part of the flow, and a push and a PR are the two things the harness still asks you for. Sequentially it rides the green the slice's own verify just wrote; a parallel wave has to open a GREEN WINDOW around it: `verify_green=true`, the slice's `git add -A` and `git commit` in its own worktree, `verify_green=false` — three commands with nothing between them, one slice at a time. Both layers read one repository-keyed flag and neither can attribute it to one worktree or agent session, so while that window is open the rail is open REPOSITORY-WIDE: any marked agent commit from any tree or concurrent session can clear both layers. The window is a deliberate accidental-bypass window, and the only thing that pays for it is keeping it that short.
- The gated verbs are `commit`, `commit-tree`, `update-ref`, `filter-branch`, `replace`, and `fast-import`. Every other history-writing verb passes on purpose: `revert`, `merge`, `rebase`, `cherry-pick`, and `am` spell their `--abort`/`--continue` recovery with the same token as the verb itself, and denying the recovery would deadlock a session that cannot run verify mid-conflict.
- The matcher reads at most 3072 bytes of a Bash call's `command` field. Past that nothing is decoded and nothing is lexed: the line becomes residue, which the gate allows — and an armed repository that is not yet green records it as `residue-allowed` in `~/.local/state/oso-code/events.jsonl`, so what slips past the rail is measured instead of invisible. The coverage cost is stated plainly: the commit rail stops applying to a command line longer than that.
- An `Edit`, `Write`, `MultiEdit`, or `NotebookEdit` — and `mcp__fallow__fix_apply`, gated the same way — is denied in plan mode while no slice is active. `/quick` and `/debug` edits are never gated this way.
- Nothing is gated until a mode arms the repo: with no repository state file the hooks allow silently and log nothing. Once the state is armed the polarity flips — a state file that exists but cannot be read (a directory, wrong permissions, a read error) denies the call and logs `state-unreadable`, and the denial names the repair: `oso-state --session <id> clear`.
- A missing jq degrades the hooks instead of denying anything: they read their JSON payload with jq where it exists and with a pure-bash reader where it does not, because a marketplace install never runs `install.sh` and a GUI-launched macOS client has no Homebrew on its PATH. A gate that judges a call on the fallback reader records a `jq-absent` event, which is what makes the degradation measurable; an unarmed repository still records nothing.

State is per-repository, in `~/.local/state/oso-code/<digest>.state`, where the digest is the SHA-256 of `git rev-parse --path-format=absolute --git-common-dir` (ADR-0095): the main checkout, every linked worktree and any subdirectory of either resolve to one file, which is what lets the gate firing in a wave's worktree read the state the orchestrator armed. Codex plan artifacts use that same identity below `~/.local/state/oso-code/plans/<digest>/`: a pending `presented-<approval-digest>.md` becomes immutable `approved-<approval-digest>.md` on native approval, while `current.md` tracks execution and explicit in-scope hot slices. Those bounded amendments also update Engram; material scope or ledger changes become roadmap work or require fresh Plan Mode approval. No plan file enters the project repository, and Claude's native `ExitPlanMode` flow is unchanged. A digest rather than that path sanitized, because no file name built out of a path keeps two repositories apart — dash every byte outside `a-zA-Z0-9-` and `my_app`, `my-app`, `my app` and `my.app` become one name, and a repository nested past `NAME_MAX` gets no name at all — and two repositories on one state file is a red one's commit gate opening on its neighbour's green. SessionEnd deletes the file the ending session armed — the file records which session that was — so a session that is killed leaves it standing, and the next session in that repo inherits flags that deny rather than allow (it is reported at the next start and ages out on its own). A `repo_path` key names the main checkout — the one input SessionEnd has for removing the worktrees a wave left standing (`git worktree remove`, then `git worktree prune`, in that repo) before the state file goes; those worktrees and the event log stay keyed by session. Resume by invoking plan again with your host's spelling, which re-arms it. `oso-state --session <id> clear` disarms a flow you walk away from mid-change, so a stale green does not ride over later unrelated work.

These are a discipline rail, not a lock: they consult a flag the agent itself writes through an ungated command, so they stop the accidental slip (the forgotten verify, the edit between slices) and never a deliberate bypass. The git layer fires only for a process carrying an agent's marker — `CLAUDE_CODE_SESSION_ID`, which the client puts in everything its Bash tool starts, or `OSO_AGENT` on a host that publishes no session id — so a commit you make in your own terminal never meets it: no verdict, no trace, whatever the repo's state says. Opt out with `bash bootstrap/install.sh --no-git-hook` (`-NoGitHook` on `install.ps1`) on Claude Code or `bash bootstrap/install-codex.sh --no-git-hook` on Codex; either installer also declines to wire over another tool's existing hook ownership and says so in its summary.

**Model expectation**: plan and debug are multi-turn flows, so choose the session's strongest reasoning model before starting one. Claude's forked judges pin Opus; Codex installs dedicated judge roles pinned to its verified model/reasoning contract. The exact host differences and deliberate degradations are release contract, not implied equivalence; see [the parity ledger](docs/parity-codex.md).

## Design principles

1. The orchestrator guides; the human decides. Options with tradeoffs, never silent assumptions.
2. Hooks enforce mechanical state and the bounded approval transport; they never make a semantic judgment about plan content. Planning runs in native Plan Mode.
3. Context is a budget: global instructions stay under 2k tokens; behavior loads on demand via skills.
4. Engram stores decisions and summaries — not phase noise.
