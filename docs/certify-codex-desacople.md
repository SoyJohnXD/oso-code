# Codex desacople certification

A recorded demonstration, not a check, in the shape `docs/certify-codex-native-cycle.md` already
established for itself. That file certified the arm→apply→verify→commit rail; this one certifies a
single later change, `codex-desacople` (`60347f2..aa27787`), against the parts of it `codex exec`
can actually drive. It is evidence about the run named below and about nothing else; re-running it
produces a new record rather than re-proving this one.

## Conditions

- **Binary**: `codex-cli 0.153.2`, the `SUPPORTED_CODEX_VERSION` pin in
  `core/src/install/pins.ts:4`, confirmed against the host's own `codex --version` before the run.
- **Home**: a disposable tree built for this run and nowhere else. `HOME`, `USERPROFILE`,
  `CODEX_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME` and
  `GIT_CONFIG_GLOBAL` all resolved inside it. No path the run could name reached the operator's own
  `~/.codex` or `~/.local/state/oso-code`; both were stat-checked before and after and neither
  changed. Only `auth.json` was copied in, read once from the operator's Codex home, never written
  back. Every path below is written as `<HOME>` or `<HOME2>` for this reason — the real ones are
  throwaway directories under this session's own scratch tree, not the operator's machine.
- **Runtime**: installed from this working tree with
  `node bootstrap/oso.js install --host codex --yes --no-impeccable --no-git-hook`, so the run
  measured the change rather than the released plugin. Run twice, against two separate disposable
  homes — `<HOME>` for the install, sandbox, write and gate checks, `<HOME2>` for the migration
  checks — so neither run's state crossed into the other's.
- **Project**: a throwaway `git init` repository inside `<HOME>`, with no commit before the run,
  built the same way the native-cycle certification's own project was.
- Two flags are declined for the reasons `docs/certify-codex-native-cycle.md` already gives:
  `--no-impeccable` keeps the install off GitHub; `--no-git-hook` is required because the installer
  wires `core.hooksPath` in the SOURCE checkout, which is the operator's own repository.
- **Round 2**: three additional probes below ran against this working tree's own built
  `plugin/bin/oso-state` and `plugin/dist/gate.js` directly, under a third disposable tree,
  `<HOME3>`, built for this reason and removed after. No fresh install was needed for them: none
  touches Codex's own config or sandbox, only the state file, the wait mark and the native rollout
  mechanics those two built artifacts already carry.

## The emptied profile (ADR-0158)

Install printed `Codex permissions are seeded once outside the managed region, and no later install
rewrites that choice`, wired 8, and failed 1 (`fallow-mcp` is not installed on this host — an
expected local-host gap, not a defect this change introduced). The rendered `<HOME>/.codex/config.toml`
carries exactly what `renderOsoPermissionProfile` (`core/src/install/codex-config.ts:47`) states:

```toml
[permissions.oso]
extends = ":workspace"

description = "oso-code workspace profile"

[permissions.oso.workspace_roots]
"<HOME>/.local/state/oso-code" = true
"<HOME>/.local/state/oso-code/worktrees" = true

[permissions.oso.filesystem.":workspace_roots"]
".git/**" = "write"
".git/config" = "read"

[permissions.oso.network]
enabled = true

[permissions.oso.network.domains]
"169.254.169.254" = "deny"
"metadata.google.internal" = "deny"
```

`extends`, both workspace roots, the `.git/**`/`.git/config` pair and the two cloud-metadata denies
are all present. A count of the 23 legacy secret globs (`**/secrets/*`, `**/*.key`, `**/*.pem`,
every `.env` variant, `.npmrc`, the certificate and keystore extensions, every `id_*` key basename,
`.ssh/**`, `.aws/**`, `.config/gcloud/**`, `.azure/**`, `.kube/**`) and of `glob_scan_max_depth`
against the rendered file returned zero matches. `codex sandbox -P oso -- /bin/true` exited 0 on
the first try, with the `worktrees` root already present on disk because install creates it —
the defect `docs/certify-codex-native-cycle.md` recorded and closed stayed closed here.

## The migration (ADR-0158)

`<HOME2>` was installed fresh, then its `[permissions.oso]` table was overwritten, byte for byte,
with `legacyOsoPermissionProfile`'s own rendered text (`core/src/install/codex-migrate.ts:172`) —
the ADR-0121 shape, 23 globs, `glob_scan_max_depth = 6` and the inert `"*" = "allow"` line included.

`node bootstrap/oso.js migrate --host codex --yes` against that seed printed
`codex oso permission profile: OK — migrated to the current oso-code shape` and wrote a pre-migration
backup. The resulting `[permissions.oso]` table matched the emptied shape above exactly — zero
matches for the same 23-glob-plus-depth-plus-wildcard scan. Running the same command again, unchanged,
printed `already the current oso-code shape; nothing to migrate` and wrote no second backup.

A third run, against a copy edited by hand (`description = "operator edited this by hand"` in place
of the installer's own line), printed:

```
oso migrate --host codex: declined: the permission profile matches neither the shape oso-code
used to write nor the one it writes today: treating it as the operator's own; touching nothing
```

Exit code 1. The file was confirmed unchanged afterward and no third backup was written — the
decline touched nothing, as the message claims.

## The honest write messages (D9, ADR-0159)

With `<HOME>/.local/state/oso-code` reduced to `dr-x------` (no write bit), a plain state write
through the installed `oso-state` binary produced this and exited 1:

```
oso-state: set: cannot write the oso-code state directory <HOME>/.local/state/oso-code: EACCES:
permission denied, access '<HOME>/.local/state/oso-code'. The gates read what it holds and treat
an unwritten state as no armed session, so arming here would leave them unable to see their own
state. Grant the directory to the active permission mode — add it to that profile's workspace
roots, launch with --add-dir <HOME>/.local/state/oso-code, or pick a mode that can write — then
arm again.
```

This is `remedyForUnwritableStateRoot`'s `EACCES`/`EPERM` branch (`core/src/state/store.ts:69`),
reached through `requireWritableStateRoot` (`core/src/state/store.ts:398`). A healthy write against
the same root, run first, had succeeded and read back cleanly — the failure above is the directory
permission alone, not a broken install.

## The loud gates (D9, ADR-0159)

Three SessionStart calls against `node dist/gate.js stale`, fed a Codex-shaped payload naming the
throwaway repository (or, for the third, a plain directory with no repository and no
`OSO_TASK_ROOT`) as `cwd`, each printed a `hookSpecificOutput.additionalContext` an operator would
actually see, and each exited 0 — the rail speaks without ever blocking the session:

- **State root unreadable** (`d---------`, an existing state file inside it): `unusableStateMessage`
  (`core/src/gates/preflight.ts:100`) —
  `"oso-code: this session is armed but its state file (...) cannot be read, so the gate cannot
  tell whether this call is safe. Remove or repair it (oso-state --session 1 clear), then retry."`
- **State root exists, write blocked, no state file** (`dr-x------`): `unwritableStateMessage`
  (`core/src/gates/preflight.ts:125`) wrapping the same `StateRootUnwritableError` text the write
  test above produced, this time surfaced as session-start context rather than a command's own exit.
- **No task identity resolves at all** (`cwd` outside any git repository, `OSO_TASK_ROOT` unset):
  `unidentifiedStateMessage` (`core/src/gates/preflight.ts:117`), run live against `<HOME3>` for
  this round — `"oso-code: this session can name none of its own (fatal: not a git repository ...)
  until OSO_TASK_ROOT declares one, so this session's gates read every call here as no session
  armed and allow without saying so. Run inside a git repository, or declare OSO_TASK_ROOT, then
  start a fresh session to arm them."`

All three messages trace to `judgeStale` (`core/src/gates/stale.ts:35`), the one gate every host
runs at session start per ADR-0159, which now tells `unusable`, `unwritable` and `unidentified`
apart rather than sharing one silent `allow`. The write test and the first two of these exercise
the same underlying fault through two different doors; all three name it rather than staying
silent.

## The AUTO continuation net (ADR-0145, ADR-0150)

The first round of this certification called this surface unaltered by this change. That was
false: commit `809d4d9` rewrites `core/src/gates/autocontinue.ts` and
`core/src/gates/delegation.ts`, the Stop-gate net that decides whether an unattended `auto=running`
run keeps going. This round drove it directly against `<HOME3>`, feeding
`plugin/dist/gate.js autocontinue` a Stop payload under the fixed `OSO_AGENT=1` marker every Codex
state call carries, against a state file and wait mark seeded on disk — exactly as the loud gates
above were fed a SessionStart payload.

- **A crossing refreshes the clock instead of inheriting a stale one.** A wait mark for
  `run=child-one label=wave-2`, its mtime set 50 minutes in the past — past the 45-minute ceiling —
  stood when the state file moved to `run=child-two` under the same label. The Stop call held
  (`{}`, no push); the mark was rewritten `run=child-two` with its mtime moved forward to the
  call's own time, carrying the label across the crossing on a fresh clock rather than the old
  timestamp the pre-fix code put back.
- **A genuinely expired, unmoving delegation is still declared lost.** The same run and label,
  aged past the ceiling, no journal growth since marked, and its renewals already at
  `DELEGATION_WAIT_RENEWALS_CAP`, pushed the run forward with `EXPIRED_DELEGATION_CLAUSE`'s own
  text appended, rather than holding it forever.
- **Milestones alone no longer reset the push cap.** With no delegation armed, four consecutive
  Stop calls, each preceded by an `oso-state journal` milestone append and no state-file rewrite
  between them, pushed the run on its first three and reached `PUSHES_WITHOUT_PROGRESS_CAP` on the
  fourth. The cap milestone landed in the journal, `pushes=4` stood in the tally, and that call's
  own verdict let the stop stand, reproducing live the exact defect `809d4d9`'s own message names:

  ```
  auto-continue: cap reached after 3 pushes without progress — allowing the stop
  ```

## The resumed session's receipt (ADR-0160)

Commit `f8d9b0a` adds `handoff adopt` and closes a receipt-hijack hole in `consume`
(`core/src/state/handoff.ts`), governed by ADR-0160. The first round's certification never
mentioned it. This round drove both, live, against a second disposable tree inside `<HOME3>`.

A fake native rollout named a child agent at `/root/child`, role `oso-applier`, parented by one
Codex thread; `oso-state handoff publish` recorded its receipt for slice `s1` attempt `1`. A
second, distinct thread — modelling a resumed chat, never the parent that spawned the child — then
ran `handoff adopt --agent-id <uuid> --agent-path /root/child ...` and succeeded: the resumed
session claimed a receipt it never itself spawned, by proving the UUID against the native rollout
alone, exactly as ADR-0160 describes.

That same resumed thread then tried `consume`, asserting the wrong identity twice: `--agent-path
/root/imposter` refused with *"the asserted agent path does not match its native rollout"*, and the
right path with the wrong `--agent-type oso-verifier` refused with *"the asserted agent role does
not match its native rollout"* — the hijack ADR-0160 names, closed. Asserting the identity that
actually matched the rollout then succeeded, printed the receipt and removed it; consuming the
same coordinates again immediately failed, since the proof itself now finds no live receipt to
claim.

## Plan Mode: NOT DEMONSTRATED

D15 states Plan Mode is TUI-only, and this run measured why rather than assuming it. Two commands,
run live inside `<HOME>`, both against `codex-cli 0.153.2`:

```
$ codex exec --strict-config -c collaboration_mode=plan --sandbox read-only --skip-git-repo-check "..."
Error loading config.toml: unknown configuration field `collaboration_mode` in -c/--config override
```

`--strict-config` rejects `collaboration_mode` before any model call, confirming it is not a
recognized field. A second, natural `codex exec` run (no `collaboration_mode` override at all) was
then driven end to end; its own native rollout recorded
`{"type":"task_started",...,"collaboration_mode_kind":"default"}` — a real session, with real model
output, still reports the default kind. No option this run had access to could name a different
one, so **no automated probe in this repository can drive a Plan-Mode turn**, and this certification
does not claim to have done so. What would settle it: an operator, on an installed build, starting
the interactive TUI and entering Plan Mode there, then observing whichever half of this change's
behavior Plan Mode itself touches.

## What surprised this run

- Installing into a disposable home rooted under `/tmp` made Codex itself refuse to create PATH-alias
  helper binaries (`Refusing to create helper binaries under temporary dir "/tmp"`), on every install
  in this run. The install still wired successfully and reported the refusal as a warning, not a
  failure, but a certification whose own disposability requirement places its home under `/tmp`
  will keep seeing this warning until it is run from a non-tmp disposable path instead.
- `npm test` sandboxes `HOME` itself (`core/test/support/sandbox-env.mjs`) before running
  `no-shipped-file-carries-the-home-path.test.ts`, so that test can only ever compare tracked files
  against a fresh throwaway path, never the operator's real one. Run directly, outside that sandbox,
  against this machine's own `HOME`, it reds on two carriers, not two pre-existing ones.
  `docs/decisions/0094-codex-baseline-and-minimum-version.md:60` is pre-existing and unrelated:
  `git log --follow` on that file returns only commits that predate `60347f2`, this change's own
  first commit. `docs/measure-codex-hook-sandbox.md:15` is not pre-existing at all — `git log
  --follow` on that file returns exactly one commit, `d226dc9`, itself inside `60347f2..aa27787` —
  so this change added the second carrier it was just certified not to have added. Confirming this
  certification's own file adds no third still stands; settling either carrier is outside this
  slice, exactly as this slice's own payload already said. That second carrier is also a live
  instance of what `no-shipped-file-carries-the-home-path.test.ts` exists to forbid, undetected so
  far only because catching it needs an unsandboxed run on the exact machine whose path it embeds.
  Scrubbing the path out of `docs/measure-codex-hook-sandbox.md:15` closes it properly; describing
  it here does not, and that file sits outside this document's own touch boundary regardless.
- Nothing in the reachable half failed. That is reported here as a fact this run measured, not as
  a claim that the change is complete — the unreachable half above is exactly the part a clean
  reachable half cannot speak to.

## What this run did not measure

- **The installed interactive TUI**, and therefore Plan Mode itself — recorded above as
  not-demonstrated, never as passed or skipped.
- **The git `pre-commit` hook**, declined by `--no-git-hook` for the reason the conditions section
  gives.
- **`fallow-mcp`**, absent on this host, exactly as `docs/certify-codex-native-cycle.md` also found.
- **The teardown sweeps**, which this change did not alter; `docs/certify-codex-native-cycle.md`
  already covers them for the rail this change sits on. The AUTO continuation net this change DID
  alter — `autocontinue.ts` and `delegation.ts` — is driven above instead of listed here. A full
  live multi-turn `auto=running` run, as opposed to the fed Stop payloads driven above, was outside
  this certification's own bounded-probe scope and is not claimed.

## The bar

Run against this working tree, not the disposable trees above, per this slice's verify-exception —
its own product is this record, not code the suite executes:

| Command | Result |
|---|---|
| `npm run build` | pass, no working-tree diff |
| `npm run typecheck` | pass |
| `npm test` | pass — 4318 tests, 4218 passed, 0 failed, 100 skipped |
| `npm run check` | pass |
| `cd opencode && npm test` | pass — 122 tests, 122 passed, 0 failed |
| `claude plugin validate --strict plugin` | pass |
| `claude plugin validate --strict .` | pass |
