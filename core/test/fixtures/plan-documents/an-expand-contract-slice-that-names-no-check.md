# Repaso de cambios

## Qué se va a realizar

Se cambia la firma del capturador de planes, que hoy tienen tres consumidores, con la
plantilla expand-contract que la propia §4 ofrece cuando el mapa de superficie encuentra
un contrato con muchos consumidores.

## Decisiones del ledger que lo moldean

- C1-D7 — cada slice nombra su comprobación automática o dice por qué no hay ninguna.

## Cómo va a funcionar

La forma nueva se añade junto a la vieja, los consumidores se mueven en tandas, y el
borrado de la vieja llega al final con su propia comprobación de completitud.

## Planning disposition

Phase 1 intent approved; phase 2 surface map completed; phase 3 ledger frozen (doubt pass: N/A —
no migration, security or rollback surface); phase 4 slicing completed with 3 slices in 3 waves,
widest width 1, execution mode SEQUENTIAL; phase 5 approval document ready.

## Slices

### Wave 1

- **S1 EXPAND — the new capture signature beside the old one.**
  Goal: both signatures answer, so every check stays green while the consumers are still on the old one.
  Files: `core/src/state/plan.ts`.
  Verify: `npm test`; failing-check: a capture test calling the new signature, RED without the slice.
  Depends-on: nothing.

### Wave 2

- **S2 MIGRATE (opus) — the three consumers move to the new signature.**
  Goal: the CLI, the Codex gate and the OpenCode plugin all call the new form.
  Files: `core/src/state/cli.ts`, `core/src/gates/planstop.ts`, `opencode/plugin/oso/approval.ts`.
  Verify: `npm test`; `cd opencode && npm test`; both green on the three moved call sites.
  Depends-on: S1.

### Wave 3

- **S3 CONTRACT — the old signature is deleted.**
  Goal: one signature remains, and nothing still reaches for the other.
  Files: `core/src/state/plan.ts`.
  Verify: `npm test`; a pre-delete completeness check proving zero remaining consumers, run before
  the delete lands; failing-check: that completeness check, RED against a tree with one consumer left.
  Depends-on: S2.

## Verification bar

`npm test`; `npm run typecheck`; `npm run build`; `npm run check`.
