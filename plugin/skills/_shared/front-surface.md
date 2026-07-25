# Front surface

Shared definition of what counts as a **front surface** and the design-integration contract that fires when a change touches one. Four things live here and nowhere else, referenced by path so they are never copied: the **Trigger** below, and the **pin recipe**, the **audit exit bar** and the **absence policy** under the contract. The WIRING is not among them — each mode wires the contract its own way, and the matrix below indexes those modes by pointer, never by restatement.

## Trigger

A change touches front surface when the evidence shows any of:

- **UI file types** — `.tsx`, `.jsx`, `.vue`, `.svelte`, `.astro`, `.html`; stylesheets `.css`, `.scss`, `.sass`, `.less`; or Tailwind / styled-component / CSS-in-JS configuration.
- **UI directories** — `components/`, `pages/`, `views/`, `layouts/`, `templates/`, or route directories that render markup.
- **A visible outcome** — any change whose observable result is rendered UI or user-visible visual behavior, whatever its file type.

## Integration contract

When the trigger fires, the design bar — powered by the Impeccable plugin — engages. Five points make it up, and the three modes wire them differently. Every cell below is a POINTER — the mode's own section plus what happens there — so the detail is read in the mode file, and a row read across shows where the modes diverge:

| Point | `/plan` | `/quick` | `/debug` |
|---|---|---|---|
| Design-docs check | §4 design-foundation slice — a gated FIRST slice, run by the orchestrator itself | §3 "Missing design docs" — a direct step, not a gated slice, and only for a NEW front page or feature | §5 step 1 — never runs `init` or `document`; the missing docs are named in the close |
| Coach payload | §6 step 2 — the docs and the Impeccable paths ride in the applier's slice assignment | §3 "Design reference" — no applier to coach, so quick READS them itself before iterating | §4 step 1 — the same payload rides in the diagnosis packaged as the applier's ledger |
| Pinned detect gate | §3 Verification row records the recipe, §6 step 2 resolves the numerals at the first front-touching slice; a blocked detector or an unresolvable pin takes the `Verify-exception` | §4 step 2 — the detector joins the close's checks; a blocked detector or an unresolvable pin is named as skipped | §3 freezes the numerals, §4 step 2 runs the detector as the design gate; a blocked detector or an unresolvable pin is named as skipped |
| Audit loop at close | §7 step 4 — runs after the sweep returns `Debt Sweep: clean` and `Conformance: clean`, and before verify_green | §4 step 3 — runs after the project's checks are clean and before the commit gate unlocks | none — §4 step 2 makes detect the design gate instead |
| Absence policy | §2 step 3 — the gap goes in the ledger | §3 "Absence policy" — the gap goes in the close's session summary | §4 step 1 — the gap goes in the diagnosis notes |

Three of those rows rest on text that IS shared: the pin recipe, the audit exit bar and the absence policy below are this file's own, and they bind every mode that reaches them.

### Pinned detect gate — the pin recipe

Impeccable ships on TWO independent release lines that share no numbering — the Claude Code marketplace plugin and the npm CLI — so the pin is NEVER read off the installed plugin's version; it is resolved from the npm channel by this recipe, the single source for it:

- **Resolve the pin** — run `npx impeccable --version`. The numeral that command returns IS the pin, and the detector then runs as `npx impeccable@<that numeral> detect`.
- **Record both numerals** — the CLI's, from `npx impeccable --version`, and the plugin's, from `claude plugin list`, where the invoking mode records things (`/plan` → the ledger's Verification row, `/quick` → the close's session summary, `/debug` → the diagnosis freeze). Both, because the arm that JUDGES design — the `audit` skill and its `reference/` playbooks — ships with the plugin, which bootstrap installs unversioned, so pinning the CLI alone leaves the judging half unpinned.
- **When it is resolved** — `/plan` resolves at its first front-touching slice (§6), never during planning: `npx impeccable --version` fetches and executes a package, and plan's phases 1–5 run inside read-only Plan Mode, so §3 records the recipe and the commitment while §6 produces the numerals. `/quick` and `/debug` are not in Plan Mode: `/quick` resolves when the front work starts (§4 step 2), `/debug` at the §3 diagnosis freeze.
- **Never silent** — a detector false positive is silenced through Impeccable's own config or an inline disable, no new machinery either way. A detector the environment blocks — and equally a pin that cannot be resolved at all (no Node, offline, registry error) — is NAMED in the mode's own record, in the form that mode has for it: never left as an unresolved placeholder, never dropped.

### Audit loop at close — the exit bar

The `impeccable:impeccable` skill is invoked through the Skill tool with `audit <touched surfaces>` and runs judge→fix→re-audit. `audit`, `init`, and `document` are ARGUMENTS of that one skill, never skill names of their own. What ends the loop, what it reports, and who fixes what it finds are written here once, for every mode that runs it:

- **Exit bar, read as an ADAPTER** — Impeccable emits no `clean` token: its `audit` reports an Audit Health Score with rating bands, a Pass/Fail integrity verdict, and findings graded P0 through P3. This harness does not vendor that report, so the bar below is a TRANSLATION of two of its fields — the loop is done when the integrity verdict is `Pass` AND no P0 or P1 finding is open. Those two fields, the integrity verdict and the severity bands, are where to look when upstream changes shape, and this bullet is what moves with them.
- **Operator escape** — the loop also ends when the operator explicitly accepts the residual. The escape stands beside the bar above, never in its place.
- **Never silent** — the rule the detect gate states above reaches this loop's exit too: a P2 or P3 finding still open when the loop ends is NAMED in the record of the mode that ran it (`/plan` → the ledger, `/quick` → the close's session summary), never dropped because the loop was allowed to end.
- **Fix route** — findings go to the `oso-applier` agent in fresh context, handed over as the `judge findings` assignment kind and never fixed inline — the route accepted security findings already take. Each round is proved by TWO things: the re-audit, which shows the design finding died, and the project's own zero-warnings bar, which shows nothing else broke. The ORCHESTRATOR runs that bar — an `audit` judges design and runs no project checks, unlike `oso-code:debt-sweep`, whose §1 runs the project bar as part of its axis — so without it a design fix could break a test and the re-audit would still come back done.

### Absence policy

When Impeccable is not installed: name the gap to the operator, give the two-step install — `/plugin marketplace add pbakaus/impeccable` then `/plugin install impeccable@impeccable` — and continue WITHOUT the design bar, recording the gap visibly where the invoking mode records it (`/plan` → the ledger, `/quick` → the close's session summary, `/debug` → the diagnosis notes). Never skip the design bar silently. This is the single source for the policy; the modes point here.
