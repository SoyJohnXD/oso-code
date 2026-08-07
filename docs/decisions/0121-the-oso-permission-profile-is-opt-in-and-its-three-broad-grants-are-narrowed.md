# 0121 — The oso permission profile is opt-in, and its three broad grants are narrowed

Date: 2026-08-06
Status: accepted
Superseded-by: ADR-0122 — retires only the `default_permissions` clause (the profile returns to the machine default `"oso"`, since Codex has no per-project profile selection to opt into); the narrowed `.git`, network and secret-denylist grants, and the host-contract check proving the override mechanism is real, all still stand
Reconciled: superseded — the `default_permissions` clause above is retired by ADR-0122, which reverts the rendered `config.toml` to the machine default `"oso"`; `.git`, network and the secret denylist stay narrowed exactly as decided here, and `bootstrap/verify-codex.sh` still carries the host-contract check proving the override mechanism is real, independent of whether the harness's own default relies on it.
Source: this change (codex-fluidity), ledger decision D11; the doubt pass that found `default_permissions = "oso"` was the operator's machine-wide default and that a denylist extended by enumeration was being enumerated again

## Decision

### The profile stops being the global default

Empirically, against the installed `codex-cli 0.146.0` binary (`codex --help`, `codex exec --help`, `codex sandbox --help`, and `rg -a -o` over the resolved binary, the same method ADR-0106 used): `-P`/`--permission-profile` exists only on `codex sandbox`, a one-shot command runner never used to launch a real session. Neither `codex` (interactive) nor `codex exec` (the real session launchers) carry a dedicated profile flag. Both do, however, accept the generic `-c key=value` override on any top-level config key, and `default_permissions` is one such key — proven by two literals the binary itself carries: `` default_permissions refers to undefined profile ` `` (the value is validated against real profile names) and `` `permission_profile` and `default_permissions` overrides cannot both be set `` (the two are recognized, mutually exclusive override sources). `-c default_permissions=oso` was verified end-to-end against a scratch `$CODEX_HOME`: a bare `codex exec` reports `sandbox: workspace-write [workdir, /tmp, $TMPDIR]` (no oso roots, no network), while `codex exec -c default_permissions=oso` reports the full oso workspace roots and network enabled.

This is outcome 1 of the three the slice named: **per-invocation selection exists and the operator controls it.** The rendered config now sets:

```
default_permissions = ":workspace"
```

`:workspace` is not invented for this decision — it is the exact built-in identifier `[permissions.oso] extends = ":workspace"` already named as its own parent. A bare `codex` or `codex exec` session — one the operator did not explicitly mark as oso-code work — gets precisely what a stock Codex install would give it: the session's own working directory, writable, `.git` protected by Codex's own built-in rule, no extra workspace roots, no network. The oso profile is reached only by an explicit `-c default_permissions=oso` on that one invocation — a flag supplied before the model exists for that process, never something a running model can add to its own already-launched session. This is not the mechanism the identity bridge in A4/A5 was rejected for: there the model *selected* its own privilege boundary mid-session; here the boundary is fixed at process launch by whoever typed the command, and the model inside that process has no channel to change it.

`bootstrap/verify-codex.sh` gains `permission_override_contract_status`, the same four-outcome shape (`conformant`/`nonconformant`/`unverified:<version>`/`codex-not-on-path`) as ADR-0106's `host_contract_status`, checked against the same two literals above. `tests/hooks-test.sh` drives it through a fake `codex` shim exactly as ADR-0106's own case does, reusing that case's skip fixture rather than duplicating it.

### `.git`: narrowed to what plumbing needs, with an examined, tool-constrained residual

The harness's own git operations (`git add`, `git commit`, `git worktree add`/`remove`, `git branch -d` — run directly by the top-level orchestrator session under this profile, per `plugin/skills/_shared/platform/codex/plan.md`) touch `.git/index` (plus its `.lock` sibling), `.git/objects/**`, `.git/refs/**`, `.git/logs/**`, `.git/worktrees/**`, and `.git/packed-refs`. Verified with `codex sandbox -P oso` against a scratch git repository (never the operator's real `~/.codex/config.toml`, never the real repo, never `git stash`): Codex's write-grant engine accepts only two shapes for a `write` entry — an exact path or a `<prefix>/**` subtree — and a brand-new file (a lock file that has never existed) can only be created under a granted `/**` subtree, never under an exact-path entry for that same not-yet-existing name. Since git's index-locking mechanism creates `index.lock`/`packed-refs.lock` fresh, directly at the git-dir root, on every operation, and the engine has no "this directory's own files but not its subdirectories" primitive, `.git/**` = `"write"` is retained — examined, not left unexamined as it was before this change.

One additional exact entry was proven both effective and safe:

```
".git/**" = "write"
".git/config" = "read"
```

`.git/config` = `"read"` was verified to close the `core.hooksPath`/remote-redirect vector (`git config`/`git status` still succeed; a write to `.git/config` is denied) without breaking ordinary git reads (a full `"deny"` was tried first and broke every git command, since git reads its own config constantly — `read` is the correct mode, not `deny`).

**`.git/hooks` = `"deny"` was attempted and dropped.** In isolation it worked exactly as intended — directory-level exact deny blocks creating, overwriting, and deleting any hook file while leaving git's own hook-lookup reads intact (`git status`, `git hook run pre-commit` both still functioned). Combined with `.git/config` = `"read"`, though, Codex's sandbox launcher (`bwrap`) fails to start the session outright — `bwrap: Can't create file at <path>/.git: Is a directory` — whenever `.git` does not exist as a real directory on one of the profile's *other* declared workspace roots (`$state_root`, `$worktree_root`; neither is a git repository, but the `":workspace_roots"` filesystem table applies identically to every declared root, not just the one the session happens to be working in). This was isolated by testing `.git/hooks` alone (fine), `.git/config` alone (fine), the two together (crashes, both `"deny"` and mixed `"deny"`/`"read"`), and a full enumeration of git's fixed standard hook names as individual file-shaped exact entries alongside `.git/config` (still crashes) — confirmed stable only with a single additional exact entry under `.git/`, three repeated launches. This is a verified constraint of the installed engine, not a guess, and not something a config change alone can work around without either dropping one of the two protections or materializing decoy `.git` directories under the state/worktree roots at install time (out of this slice's scope: it would move config-writer responsibility into new installer machinery for a fixture directory purpose-built to appease a sandbox launcher bug).

Between the two, `.git/config` was kept: it is the more load-bearing of the two, because a session that can still rewrite `core.hooksPath` can point it at any other writable location and drop a hook there regardless of whether `.git/hooks` itself is protected — protecting config is what keeps a hooks-protection meaningful at all, even though this slice cannot also add the hooks-specific rule. `.git/hooks` write is retained as a residual: examined and empirically bounded by the sandbox's own launch behavior, not overlooked.

### Network: examined, allowlist declined with a stated reason, one concrete deny added

MCP servers (`context7`, `fallow`) are unaffected by `permissions.oso.network` regardless of its shape — Codex's own MCP tool exposure carries no sandbox-mode filter (verified against the upstream source: `codex-rs/core/src/mcp_tool_exposure.rs` filters only by Apps-server exclusion, model visibility and connector policy). What this network grant *does* govern is every shell-issued network call the session's own tool use makes — and this profile's sandbox is also the one under which the harness runs the operator's own project's zero-warnings bar (build, test, install) on every verify loop, not only oso-code's own internal needs. A precise allowlist limited to oso-code's own known destinations (the npm registry for Impeccable's pinned `detect`) would silently break any project whose own build or test step reaches a different registry, a different git host, or an API under test — outcomes this harness cannot enumerate per-project. `"*" = "allow"` is kept for that reason, stated rather than left implicit.

One concrete, safe narrowing was added — it cannot break a legitimate project's own network use, because no legitimate in-repo tooling targets it:

```
"169.254.169.254" = "deny"
"metadata.google.internal" = "deny"
```

`169.254.169.254` is the shared cloud instance-metadata address (AWS, Azure, GCP, DigitalOcean, Oracle all use it by convention) — the classic SSRF-to-credential-theft route for an agent with broad egress. `metadata.google.internal` is GCP's named alias for the same endpoint. Denying both closes a concrete exfiltration path without touching the wide grant a generic project's own tooling needs.

### The secret denylist: extended by principle, not enumeration a second time

The denylist that already failed enumeration once (six patterns, missing `.env.production`, `.npmrc`, cloud credential paths, `.p12`, `.jks`, extensionless SSH keys) is extended along three named categories rather than a longer flat list:

1. **Named files that convention marks as holding a real per-tier secret** — `.env`, `.env.local`, `.env.*.local` (existing) plus `.env.production` (added). Deliberately *not* a blanket `**/.env.*`: that would also catch `.env.example`/`.env.sample`-style templates many frameworks expect a contributor to read and extend as ordinary, non-secret project work — denying those would be a functional regression traded for no security gain, since a template by definition holds no real secret.
2. **Private-key container formats, by extension or by conventional basename** — `.key`, `.pem` (existing) plus `.p12`, `.pfx`, `.jks`, `.keystore` (same material category, added together rather than stopping at the two named in the brief) and the standard `ssh-keygen` default basenames `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ecdsa_sk`, `id_ed25519`, `id_ed25519_sk` — none of which carry an extension, which is exactly why they were missed the first time. `.npmrc` (a single named file whose sole purpose is an auth token) belongs to this same "credential file interspersed among ordinary project files" shape.
3. **Whole dedicated credential-store directories** — `.ssh/**`, `.aws/**`, `.config/gcloud/**`, `.azure/**`, `.kube/**`. Anything inside one of these directories is presumptively credential material by convention; a coding agent has no legitimate reason to read an arbitrary file there, so the directory is denied wholesale rather than guessing at every filename a given cloud CLI might write inside it.

`glob_scan_max_depth` moved from `4` to `6` so the deeper credential-store patterns (`.config/gcloud/legacy_credentials/<account>/adc.json` and similar) are still reached, verified by re-running the config through `codex sandbox -P oso` after the change.

## Context

The pre-freeze doubt pass raised two points this decision answers directly. First, that narrowing only the read denylist while leaving `.git/**` write and network `"*"` untouched left two of the three grants exactly as broad as the original defect — this decision narrows all three, and where a grant could not be narrowed further (`.git/**`'s subtree write, the network wildcard), it states the tool constraint or the functional reason rather than leaving the grant silently unexamined. Second, that letting the *model* select a wider permission profile is the same privilege inversion the identity bridge was rejected for in A4/A5 — this decision's mechanism is a CLI override supplied at process launch, structurally unreachable by the model running inside that process, which is the opposite shape from a model-issued tool call choosing its own sandbox.

Every empirical claim in this decision — the CLI surface, the write-grant shape rules, the workspace-root default-write behavior, the exact-vs-glob precedence for filesystem deny rules, the `bwrap` materialization crash and its isolation, the network MCP-exemption — was verified against the installed `codex-cli 0.146.0` binary and a scratch `$CODEX_HOME`/scratch git repository via `codex sandbox -P <profile>`, never against the operator's real `~/.codex/config.toml`, never via `git stash`, and never by running `bootstrap/install-codex.sh`.

One grant this slice examined and chose *not* to narrow further: `workspace_roots` (`$state_root`, `$worktree_root`). `oso-state` writes per-repository files named by a SHA-256 digest computed at runtime (ADR-0095) and install-backup snapshots are named by timestamp and PID — both dynamically named, unenumerable at install time, and subject to the identical write-grant-shape constraint that forced `.git/**` to stay a full subtree. A wildcard `deny` carve-out for `install-backup-*/**` was tested against the workspace root's own default write and does not override it (glob-vs-glob precedence favors the broader grant here, the same behavior found for `.git/hooks/**` vs `.git/**`). This residual — one oso-profile session can, in principle, reach another repository's plan documents, state flags, or install-backup snapshot under the same operator's own account — is real and is not eliminated by this slice. It is a materially narrower boundary than before (only sessions the operator explicitly opts in reach it at all, not every unrelated conversation), and the ADR states this plainly rather than implying it was closed.

## Consequences

- Every Codex session the operator starts without `-c default_permissions=oso` gets Codex's own stock `:workspace` profile — the machine no longer defaults every conversation to the oso-code workspace grant.
- `.git/config` can no longer be rewritten by any oso-profile session; `.git/hooks` remains writable, an examined and documented residual rather than an unexamined one, bounded by a verified `bwrap` launch-failure constraint.
- The metadata-IMDS SSRF route is closed for every oso-profile session without touching the wide network grant a generic project's own build/test tooling needs.
- Six additional named secret categories (plus their principled siblings) are denied; `docs/blueprint.md`'s index gains this decision under the existing 2026-08-05 — codex-fluidity heading.
- `bootstrap/verify-codex.sh` carries a second host-contract check proving the `-c default_permissions=<name>` override this decision relies on is a real, host-validated mechanism rather than an assumed one — the discipline ADR-0106 established, applied to a second durable claim about the installed binary.
