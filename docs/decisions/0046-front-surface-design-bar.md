# 0046 — The front-surface design bar, powered by Impeccable

Date: 2026-07-24
Status: accepted
Superseded-by: ADR-0059 (retires the pin instruction — the pin is resolved from the npm channel, not the plugin's version), ADR-0064 (narrows front-surface.md's single-source claim to what it holds), ADR-0067 (retires "only the plugin check goes red on opt-out"), ADR-0073 (bounds the `npx impeccable --version` check), ADR-0116 (retires this file's and bodies/plan.md's undifferentiated `DESIGN.md`/`PRODUCT.md` phrasing for what `init` and `document` each produce; the FIRST-slice structure and the orchestrator-runs-it-directly exception still stand)
Implemented-in: plugin/skills/_shared/bodies/plan.md, plugin/skills/_shared/bodies/quick.md, plugin/skills/_shared/bodies/debug.md
Reconciled: applied — Mode 1 §2/§4/§6/§7, Mode 2, Mode 3 §4 and the Tool policy impeccable row carry it.
Source: docs/blueprint.md amendment of 2026-07-24 (secfork-impeccable-pocock), joint marker (D2/D3/D8), deciding commit 7d52356

## Decision

The trigger (UI file types, UI directories, or any visibly-rendered outcome) and the integration contract live once in `plugin/skills/_shared/front-surface.md`, referenced by path from all three modes.

`/plan` wires it at §2 — front surfaces derive the design bar, under an absence policy that names the gap, gives the two-step marketplace install, and continues while recording the gap visibly in the ledger, never a silent skip; §3 — the pinned design detector joins the Verification commands, and bumping the pin is a deliberate ledger update; §4 — a design-foundation FIRST slice when the project has no `PRODUCT.md`/`DESIGN.md`, in which the ORCHESTRATOR itself runs Impeccable's `init` or `document`, a narrow ledgered exception to ADR-0001's never-writes invariant scoped exclusively to design-doc generation; §6 — the applier payload carries `DESIGN.md`/`PRODUCT.md` plus the filesystem paths to Impeccable's `SKILL.md` and its `reference/` playbooks, which the applier READS since it has no Skill tool, and the pinned detect in the slice verify bar; §7 — a front-only `audit` → fix → re-audit loop after a clean debt-sweep and before `verify_green`.

`/quick` runs the inline equivalents: it reads the docs itself, runs `init`/`document` as a direct step, and carries the pinned detect and the audit loop among the close checks. `/debug` gets the delegated payload and the pinned detect ONLY when the FIX touches front surface — no `init`/`document`, no audit loop, and the named regression test stays the exit criterion.

Bootstrap installs the plugin by default through `wire_impeccable()` (the `wire_engram` pattern) with `--no-impeccable` to opt out, forwarded from `install.ps1` as `-NoImpeccable`, pure ASCII; `verify.sh` gains two checks — the plugin listed AND `npx impeccable --version` exiting 0, which is the runtime path the pinned detect gate actually takes. Only the plugin check goes red on opt-out, since npx resolves impeccable from the public registry rather than from the plugin install.

## Context

Filed under one marker covering three numbers, and the entry never separates them: one design bar, wired at five points across three modes and installed by one bootstrap step.

The `D2(b)` and `D3` citations that reached the skills address sub-decisions the amendment log does not preserve, so both resolve here, at the finest unit the log actually holds.
