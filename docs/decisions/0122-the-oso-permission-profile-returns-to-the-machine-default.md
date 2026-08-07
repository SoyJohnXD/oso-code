# 0122 — The oso permission profile returns to the machine default

Date: 2026-08-06
Status: accepted
Supersedes: ADR-0121 (only its `default_permissions` clause — the profile moves back to the machine default `"oso"`; the narrowed `.git`, network and secret-denylist grants, and the host-contract check proving the override mechanism is real, all stand unchanged)
Reconciled: applied — the rendered `config.toml` writes `default_permissions = "oso"` again; README's operator-facing note and the fixture assertions read the machine-default profile instead of a per-invocation override.
Source: this change (codex-fluidity); the operator's reversal of ledger decision D11's opt-in clause, with the tradeoff put to them explicitly against ADR-0121's own finding

## Decision

### No per-project selection exists to opt into

Empirically, against the installed `codex-cli 0.146.0` binary (`rg -a -o` over the resolved binary, the same method ADR-0106 and ADR-0121 used): the `[projects."<path>"]` table Codex itself reads and writes carries exactly three keys — `trust_level`, `policy`, `auto_review` — none of them a permission-profile selector, and no other project-scoped or directory-scoped selection surface exists anywhere in the binary. The only selector ADR-0121 found real is the process-launch override `-c default_permissions=<name>`, which is global to the invocation, not scoped to a repository, a directory, or any other identity Codex tracks per project.

Given that constraint, "opt-in" never meant "the oso profile only for oso-code work" — it meant typing `-c default_permissions=oso` on every Codex launch, permanently, with no way to bind it to a project and no lighter alternative to grow into later, because the binary has no per-project concept to bind it to. That is standing friction added on every single invocation, forever, in a change whose stated purpose is removing friction from this harness's daily use.

### The tradeoff, and why global wins it

The friction bought a security margin, but a modest one once ADR-0121's other narrowing is counted separately from the opt-in clause: the extended secret denylist (per-tier env files, private-key formats and basenames, whole credential-store directories) denies the read surface regardless of which profile is active by default; `.git/config` = `"read"` closes the `core.hooksPath` redirect regardless of scope; and the cloud-metadata address is denied on both its IP and hostname spelling regardless of scope. None of those three depend on the profile being opt-in to hold — they are properties of the `[permissions.oso]` table itself, unconditional grants and denies inside it. The margin opt-in adds on top is narrower still: whether an unrelated Codex conversation elsewhere on the machine ever runs under this table at all. Weighed against permanent per-launch friction with no scoping this binary can ever grow into, and against this repo's own established framing that its rails are "a discipline rail, not a lock" (ADR-0050; README's runtime-gates paragraph) rather than an adversarial boundary, the operator decided the margin does not clear the bar the friction costs.

The rendered config returns to:

```
default_permissions = "oso"
```

exactly as it read before ADR-0121, with `[permissions.oso]`'s `extends = ":workspace"` and every grant ADR-0121 narrowed rendering unchanged beneath it.

### What the machine gives up by going global

Stated plainly, not left implicit: a Codex session with nothing to do with oso-code — any bare `codex` or `codex exec` in any repository on this machine — again runs under the oso profile. Concretely, it can write anywhere under that repository's `.git` except `.git/config` (ADR-0121's narrowing holds there), and it can reach `[permissions.oso.workspace_roots]` — the shared `~/.local/state/oso-code` tree — meaning every repository's `oso-state` flags, every pending or approved plan document, and every install-backup snapshot the installer has ever written, not only the one belonging to the repository the unrelated session happens to be working in. ADR-0121 already named the workspace-roots half of this residual as real and undiminished by its own narrowing (its Context section, third paragraph); this decision does not create a new boundary, it removes the one piece of ADR-0121 that had shrunk which sessions could reach it at all.

### What ADR-0121 still decided, unaffected

Unaffected by this reversal: the extended secret denylist's three named categories, `.git/**` = `"write"` with `.git/config` = `"read"` narrowed inside it, the two cloud-metadata network denies, `glob_scan_max_depth = 6`, and `bootstrap/verify-codex.sh`'s `permission_override_contract_status` check. That check keeps proving a true fact about the installed binary — that `-c default_permissions=<name>` is a real, host-validated override — independent of whether the harness's own default relies on it: an operator who wants a stock `:workspace` session inside an oso-installed `$CODEX_HOME` can still reach one with `-c default_permissions=:workspace`, the identical mechanism running in the opposite direction.

## Context

ADR-0121 read the operator-visible cost of the pre-existing machine-wide default and concluded per-invocation selection was worth the friction, because the alternative it weighed at the time was the undifferentiated, un-narrowed profile that shipped before this change. With the narrowing landed and separable from the selection question, the friction and the margin could be weighed against each other directly rather than against the old, wider baseline — and on that direct comparison the friction does not pay for itself: it is permanent, it has no scoping the host can ever grow into, and most of what it was protecting against is already closed by grants that hold regardless of default scope.

This correction is filed as its own decision rather than an in-place edit of ADR-0121, so a later reader can tell a corrected claim from an original one — the same discipline ADR-0105 and ADR-0111 followed for their own single-clause reversals. ADR-0121's decision paragraph keeps its original words; its header names this file as the partial supersession, scoped to the one clause.

The residual this decision reopens is recorded in `docs/parity-codex.md`'s frozen loss and degradation ledger rather than left to this file alone: that ledger already exists precisely to keep "a mitigation stays beside the boundary it cannot remove" from drifting into unwritten assumption, and `tests/hooks-test.sh` gates its row count and content — the CI-level equivalent of a broken assertion is a better failure mode for a future silent narrowing than a comment nobody re-reads. It does not belong in the divergence table above the ledger: that table states what Claude Code and Codex do not share, and Claude Code has no host-wide profile-default concept to diverge from — the loss is specific to the Codex adapter having only one selector, not a parity gap.

## Consequences

- Every Codex session on this machine, related to oso-code or not, again runs under the `oso` profile by default; no launch-time flag is required for oso-code work.
- `docs/parity-codex.md`'s frozen loss ledger gains a sixth entry naming the reopened cross-repository reach as an accepted, mitigated residual rather than an unexamined one; `tests/hooks-test.sh`'s row-count and content gates move from five to six with it.
- ADR-0121's denylist, `.git/config` read, and metadata-SSRF denies are unchanged by this decision and remain the load-bearing narrowing, independent of default scope.
- `bootstrap/verify-codex.sh`'s `permission_override_contract_status` check is unchanged: it still proves the override mechanism is real, which now matters for an operator opting *out* to `:workspace` rather than opting *in* to `oso`.
