# 0109 — A judge that runs project checks cannot stay read-only

Date: 2026-08-05
Status: accepted
Implemented-in: codex/agents/oso-debt-sweep.toml, codex/agents/oso-triage.toml, tests/hooks-test.sh, docs/parity-codex.md, docs/blueprint.md
Reconciled: applied — `oso-debt-sweep` and `oso-triage` now declare `sandbox_mode = "workspace-write"`, matching `oso-verifier`; `oso-doubt-pass` is unchanged at `read-only`; both moved role files gained an explicit never-edit-source sentence in their `developer_instructions`; the suite's judge-sandbox assertion at `tests/hooks-test.sh` splits into three named branches instead of one blanket "every judge is read-only" case, and a new assertion pins the never-edit-source sentence in the two moved files.
Source: `plugin/skills/_shared/bodies/debt-sweep.md:25` ("Run the project's zero-warnings bar") and `plugin/skills/_shared/bodies/triage.md:27,29` ("running a check is not writing code" / "re-run the failing check in the tree the gate ran it in"), read against `codex/agents/oso-debt-sweep.toml:5` and `codex/agents/oso-triage.toml:5` pinning `sandbox_mode = "read-only"`; `oso-verifier`'s existing `workspace-write` for the identical problem is the precedent; the pre-freeze doubt pass on this change raised the cost recorded below as the accepted residual

## Decision

**`oso-debt-sweep` and `oso-triage` move to `workspace-write`.** Both bodies require a command that writes to the filesystem as part of the judge's own contract — debt-sweep runs "the project's zero-warnings bar: … lint, types, tests, build, or whatever the project defines," and triage re-runs the one failing check in the tree the gate ran it in to confirm it is still current. Lint caches, `dist/`/`.next/` build output, coverage dumps and lockfile touches are ordinary side effects of those commands on most stacks. A `read-only` sandbox cannot execute either contract; it was pinning a role to a command it cannot run. `oso-verifier` already carries `workspace-write` for exactly this reason and is the precedent both roles now follow.

**`oso-doubt-pass` stays `read-only`.** Its body (`plugin/skills/_shared/bodies/doubt-pass.md`) judges a frozen-candidate decision ledger from approved intent, a surface map, and the bare decisions alone — "Work from this payload alone," never the rationale, never a live check. Nothing in its contract runs a project command, builds, or touches the filesystem beyond reading the payload and the files the surface map names. Read-only remains both correct and sufficient there, so this decision leaves it untouched.

**The suite assertion inverts.** `tests/hooks-test.sh`'s per-role loop previously had one branch for `role_kind = judge`, asserting `read-only` for all three non-security judges. That branch now splits into two: `oso-doubt-pass` gets its own named assertion pinning `read-only`, and every remaining judge (currently `oso-debt-sweep` and `oso-triage`) gets a named assertion pinning `workspace-write`. `oso-security-reviewer`'s existing `danger-full-access` branch is untouched. Every role still resolves to exactly one asserted expectation; none is exempted into an unchecked "some judges are read-only" gap.

**The never-edit-source prohibition becomes an explicit instruction.** Before this decision, "never edits" for these two roles was partly a mechanical property of `read-only` and partly a stated instruction ("Judge only. Never edit…" / "Judge read-only: never edit…"). Losing the mechanical half without changing the text would have left `oso-triage.toml` calling itself "read-only" while running `workspace-write` — a role file naming a guarantee its own sandbox no longer holds. Both role files' `developer_instructions` now open the prohibition with the reason before the list: the sandbox grants write access solely so the required check can run, and that access is never permission to edit a source file. `tests/hooks-test.sh` gained an assertion that this sentence is present in both files, so a future edit cannot quietly drop the prohibition now that the sandbox no longer carries it for free.

### Residual: an instruction is not a guarantee

`read-only` was the MECHANICAL guarantee behind "this judge never edits" — the host enforced it regardless of what the prompt said. A `developer_instructions` sentence is a promise the model is expected to keep, not a property the sandbox enforces. This decision trades the former for the latter on two roles, and the ledger accepts that cost rather than resolving it.

It is worse for `oso-triage` specifically. Triage's entire product is attribution drawn from the tree the gate ran the failing check in — an unperturbed tree is the evidence, not incidental to it. A check that now writes caches, build artifacts or coverage dumps as a side effect can perturb the very tree triage was summoned to explain, and nothing mechanical stops a future edit, or a future check the project adds, from writing somewhere attribution depends on reading cleanly.

### Rejected: a disposable writable tree per judge invocation

The alternative on the table was giving each judge invocation its own throwaway writable copy of the tree — a fresh clone or worktree the check runs in, discarded after the verdict, with the judge's own view kept read-only. Rejected for two reasons:

1. **Cost.** A disposable tree per invocation means a full checkout (or worktree) cut and torn down on every debt-sweep and every triage call, inside a harness that already cuts worktrees for parallel plan waves. Paying that cost on every judge invocation, including the common case where nothing about the project's checks writes anywhere sensitive, is disproportionate to the problem it solves.
2. **A second divergence source.** A disposable tree answers "did the judge's own writes leak into the tree it judged," but it does not answer the sharper question a judge exists to answer: does the check the operator will actually run, in the tree the operator actually has, behave the way the judge reported? A disposable tree is by construction a different tree from the one the gate ran the failing check in and the one the operator holds — triage's whole contract is to reason about that exact tree. Introducing a second tree to protect the first from perturbation would have traded one perturbation risk for a second attribution gap between what the judge saw and what the operator has.

Neither cost was worth paying against a residual this decision can instead name and accept: the instruction, backed by the "never edits" contract restated in both bodies (`debt-sweep.md`, `triage.md`) and now in both role files, is the harness's answer. No disposable tree is built.

## Consequences

- `oso-debt-sweep` and `oso-triage` can execute the commands their own bodies require them to run; before this decision, both roles were pinned to a sandbox that made their documented contract unexecutable.
- `oso-doubt-pass` is unaffected: still `read-only`, confirmed against its body rather than assumed from the old blanket rule.
- The "never edits" guarantee for the two moved roles is now enforced by instruction rather than by sandbox — an accepted, named residual, not a silent regression. `oso-triage` carries the sharper version of that cost, since its output is attribution read from an unperturbed tree.
- `tests/hooks-test.sh`'s judge-sandbox assertion resolves every judge to one specific expected value; a future judge role added to `S5_ROLE_MAP` without updating this block fails loudly on the generic `role_kind = judge` case rather than silently inheriting an unexamined default.
- `docs/parity-codex.md`'s forked-judge row states the split by name instead of "the three non-security judges are read-only," so the parity ledger stays honest about which roles are read-only and why.
