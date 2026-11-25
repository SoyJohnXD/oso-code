# Contributing

How a change is tested, how this repository grows and how it is managed. Rules a check enforces say so; the rest are held in review.

## The bar

A change closes with zero warnings from every command below, run from the repository root:

```bash
npm run typecheck
npm test
npm run check
npm run fallow
cd opencode && npm test
```

Generated files are committed. Edit their source under `core/src/`, run `npm run build`, and let `npm run check` prove the output is fresh. Source carries no inline comments: names and tests carry the meaning, and `./plugin/bin/oso-state scan comments <ref>` flags any added since a ref.

## How tests are written

- **A test earns its place.** It pins an outcome no other test pins: a message, an exit code, a written file, a verdict. Delete the twin, never the distinct case.
- **Delete by proof.** Before removing a test, run the core and OpenCode suites over a pristine `git archive` of the base and over the change. Line coverage and V8 function and branch ranges must not shrink, and a named surviving test must fail on the same regression. A test that spawns a bundled CLI is invisible to `core/src` coverage and needs the named test alone.
- **Run through the repo scripts.** `npm test` carries the sandbox that keeps tests off your real home. Never call `node --test` directly.
- **Titles say what the code does.** No decision, slice or incident id, no "ported from". *Enforced:* `core/test/structure/test-titles-cite-no-incidents.test.ts`.
- **A floor means the walk found something.** A repo-size count is written with `provedSomething` from `core/test/support/proved.ts`, never as a number that grows with the repository. Structural minimums stay.
- **Fixtures are tables.** Gate cases live one table per gate under `core/test/fixtures/gates/`. Two cases with the same input and expectation are one case. *Enforced:* `core/test/gates/parity.test.ts`.
- **A checker proves it can fail.** A test that scans the tree carries a planted input it must flag and a lookalike it must pass, so an empty result cannot come from a scanner that reads nothing.
- **Read the instrument before the number.** An exit status belongs to the process that produced it. A zero from the wrong process, ref, search mode or side of a pipe answers nothing. A pinned `process.platform` shows which cases skip, never how many.
- **POSIX is not a contract on Windows.** A platform fact inherited from a POSIX tool is not a promise of the port on win32.

## How the repository grows

- **Size is reported, never capped.** `npm run size` prints lines and bytes for each area and never fails. There is no line ceiling.
- **Time is budgeted.** `npm test` has a wall-time budget per operating system, set as `OSO_TEST_BUDGET_SECONDS` in `.github/workflows/pr.yml` and read by `core/scripts/check-test-discovery.mjs`. *Enforced.* Raising a budget needs its reason in the commit message.
- **Always-loaded context is budgeted.** Global guidance, the output style and the skill and agent descriptions each have a token budget, measured as bytes divided by 4. *Enforced:* `core/test/structure/always-loaded-budget.test.ts`. Raising one needs its reason in the commit message.
- **Dead code is removed.** `npm run fallow` runs the pinned fallow and fails on unused files, exports and dependencies. A new ignore entry in `.fallowrc.json` names the exact symbol or file and why fallow cannot see its consumer.
- **Docs are a closed list.** `docs/` holds the blueprint, the OpenCode parity record and the Windows and OpenCode purge guides. No decision records, roadmaps or plans live in the tree: a decision belongs to its change's plan ledger and its commit message, and git is the archive.
- **The CHANGELOG stays short.** About twelve lines per release. Older releases shrink to one line, and a one-line summary never keeps a claim that a later release overturned.
- **Prompts stay clean.** Shipped prompts carry no decision ids, measurement history or pointers to repository documents.

## Deleting files

A file is removed by a change whose verification shows zero live references: nothing loads, sources, spawns, copies, hashes, lists in a manifest or requires it. A name that is only an identifier (the `script` column of `core/src/routes/routes.ts` is the gate's telemetry label), a CHANGELOG record or a citation is not a reference. The same diff deletes the tests that exercised the file.

## How changes are managed

- Substantial changes go through `/oso-code:plan`, small ones through `/oso-code:quick`, breakage through `/oso-code:debug`.
- Commits are conventional (`feat`, `fix`, `test`, `docs`, `chore`, `ci`), one slice per commit, and carry no AI attribution trailer.
- Nothing is pushed, merged, released or version-bumped by automation unless the operator asks for it.
- A change to the design edits `docs/blueprint.md` in the same change.
