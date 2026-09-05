# Front surface

Shared definition of what counts as a **front surface** and the design-integration contract that fires when a change touches one. Four things live here and nowhere else: the **Trigger** below, and the **pin recipe**, the **audit exit bar** and the **absence policy** under the contract. The WIRING is not among them — each mode wires the contract its own way, and the matrix below indexes those modes by pointer, never by restatement.

## Trigger

A change touches front surface when the evidence shows any of:

- **UI file types** — `.tsx`, `.jsx`, `.vue`, `.svelte`, `.astro`, `.html`; stylesheets `.css`, `.scss`, `.sass`, `.less`; or Tailwind / styled-component / CSS-in-JS configuration.
- **UI directories** — `components/`, `pages/`, `views/`, `layouts/`, `templates/`, or route directories that render markup.
- **A visible outcome** — any change whose observable result is rendered UI or user-visible visual behavior, whatever its file type.

## Integration contract

When the trigger fires, the design bar — powered by the Impeccable plugin — engages. Five points make it up, and the three modes wire them differently. Every cell below is a POINTER — the mode's own section plus what happens there — so the detail is read in the mode file, and a row read across shows where the modes diverge:

| Point | PLAN | QUICK | DEBUG |
|---|---|---|---|
| Design-docs check | §4 design-foundation slice — a gated FIRST slice, run by the orchestrator itself | §3 "Missing design docs" — a direct step, not a gated slice, and only for a NEW front page or feature | §5 step 1 — never runs `init` or `document`; the missing docs are named in the close |
| Coach payload | §6 step 2 — the docs and the Impeccable paths ride in the applier's slice assignment | §3 "Design reference" — no applier to coach, so quick READS them itself before iterating | §4 step 1 — the same payload rides in the diagnosis packaged as the applier's ledger |
| Pinned detect gate | §3 Verification row records the recipe, §6 step 2 resolves the numerals at the first front-touching slice; a blocked detector or an unresolvable pin takes the `Verify-exception` | §4 step 2 — the detector joins the close's checks; a blocked detector or an unresolvable pin is named as skipped | §3 freezes the numerals, §4 step 2 runs the detector as the design gate; a blocked detector or an unresolvable pin is named as skipped |
| Audit loop at close | §7 step 4 — runs after the sweep has met §7 step 3's exit bar on both axes, and before verify_green | §4 step 3 — runs after the project's checks are clean and before the commit gate unlocks | none — §4 step 2 makes detect the design gate instead |
| Absence policy | §2 step 3 — the gap goes in the ledger | §3 "Absence policy" — the gap goes in the close's session summary | §4 step 1 — the gap goes in the diagnosis notes |

Each mode supplies only its own column of that table — never another mode's, and never a restatement of what its own pointer already names.

Three of those rows rest on text that IS shared: the pin recipe, the audit exit bar and the absence policy below are this file's own, and they bind every mode that reaches them.

### Pinned detect gate — the pin recipe

Impeccable ships on TWO independent release lines that share no numbering — the installed skill package and the npm CLI — so the pin is NEVER read off the installed skill's version; it is resolved from the npm channel by this recipe, the single source for it:

- **Resolve the pin, under a 20-second bound** — run `npx impeccable --version`; the numeral it returns IS the pin, and the detector then runs as `npx impeccable@<that numeral> detect`. The bound runs in-shell rather than through `timeout(1)`, which macOS does not ship, matching `bootstrap/verify.sh`'s own npx probe:

  ```bash
  ( set -m
    npx impeccable --version & pin_probe=$!
    bound_seconds=20
    waited=0
    while kill -0 "$pin_probe" 2>/dev/null; do
      if [ "$waited" -ge "$bound_seconds" ]; then
        kill -TERM "-$pin_probe" 2>/dev/null || kill -TERM "$pin_probe" 2>/dev/null
        echo "pin slow: npm did not answer within ${bound_seconds}s — retryable, never an unresolvable pin"
        break
      fi
      sleep 1
      waited=$((waited + 1))
    done
    wait "$pin_probe" 2>/dev/null )
  ```

- **A bound that fires is SLOW, never unresolvable** — this step RESOLVES the pin rather than checking anything. npm not answering inside the bound is RETRYABLE: run the recipe once more, and if the bound fires again, tell the OPERATOR the registry is not answering and that re-running the mode is what resolves the pin — never take the exception for it. Only npx failing on its own — no Node, no such package, a registry error it reports — is the unresolvable pin the bullets below name.
- **Record both numerals** — the CLI's, from `npx impeccable --version`, and the installed skill package's, obtained through the front-surface platform adapter that every invoking mode reads, where that mode records things (PLAN → the ledger's Verification row, QUICK → the close's session summary, DEBUG → the diagnosis freeze). Record both because the arm that JUDGES design — the `audit` command and its `reference/` playbooks — ships with the installed skill while the detector ships on npm, so pinning the CLI alone leaves the judging half unpinned.
- **When it is resolved** — PLAN resolves at its first front-touching slice (§6), never during planning: `npx impeccable --version` fetches and executes a package, and plan's phases 1–5 are read-only — its own ground rules keep them so whatever mode the host is left in — so §3 records the recipe and the commitment while §6 produces the numerals. QUICK and DEBUG have no such read-only phase: QUICK resolves when the front work starts (§4 step 2), DEBUG at the §3 diagnosis freeze.
- **Never silent** — a detector false positive is silenced through Impeccable's own config or an inline disable, no new machinery either way. A detector the environment blocks — and equally a pin that cannot be resolved at all (no Node, no such package, a registry error npx reports) — is NAMED in the mode's own record, in the form that mode has for it: never left as an unresolved placeholder, never dropped.

### Audit loop at close — the exit bar

Invoke the installed Impeccable skill through the front-surface platform adapter with `audit <touched surfaces>` and run judge→fix→re-audit. `audit`, `init`, and `document` are ARGUMENTS of that one skill, never skill names of their own. What ends the loop, what it reports, and who fixes what it finds are written here once, for every mode that runs it:

- **Exit bar, read as an ADAPTER** — Impeccable emits no `clean` token: its `audit` reports an Audit Health Score with rating bands, a Pass/Fail integrity verdict, and findings graded P0 through P3. This harness does not vendor that report, so the bar below is a TRANSLATION of two of its fields — the loop is done when the integrity verdict is `Pass` AND no P0 or P1 finding is open. Those two fields, the integrity verdict and the severity bands, are where to look when upstream changes shape, and this bullet is what moves with them.
- **Operator escape** — the loop also ends when the operator explicitly accepts the residual. The escape stands beside the bar above, never in its place.
- **Never silent** — the rule the detect gate states above reaches this loop's exit too: a P2 or P3 finding still open when the loop ends is NAMED in the record of the mode that ran it (PLAN → the ledger, QUICK → the close's session summary), never dropped because the loop was allowed to end.
- **Fix route** — findings go to the `oso-applier` agent in fresh context through the invoking platform's agent route, handed over as the `judge findings` assignment kind and never fixed inline — the route accepted security findings already take. That fix runs on the model the profile names for its role, named in the Launching milestone. That handoff carries the findings VERBATIM — every one with its `file:line`, the band the audit graded it at and the audit's own wording for it, never your summary of them, which is how a fix ends up answering a finding nobody made. Each round is proved by TWO things: the re-audit, which shows the design finding died, and the project's own zero-warnings bar, which shows nothing else broke. The ORCHESTRATOR runs that bar — an `audit` judges design and runs no project checks, unlike the debt-sweep judge, whose §1 runs the project bar as part of its axis — so without it a design fix could break a test and the re-audit would still come back done.

### Absence policy

When Impeccable is not installed: name the gap to the operator, give the front-surface platform adapter's install or remount remedy, and continue WITHOUT the design bar, recording the gap visibly where the invoking mode records it (PLAN → the ledger, QUICK → the close's session summary, DEBUG → the diagnosis notes). Never skip the design bar silently. This lane covers every point downstream of Impeccable's presence, PLAN's design-foundation-slice read included: `plan/SKILL.md` §4 reads the installed `SKILL.md` and records its version before cutting that slice, and when Impeccable is absent that read cannot happen — no version to record, no slice to cut — so planning CONTINUES under this same policy rather than stopping, never a second absence check invented for the one read. This is the single source for the policy; the modes point here.
