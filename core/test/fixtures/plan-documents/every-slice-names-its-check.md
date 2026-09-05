# Repaso de cambios

## Qué se va a realizar

Se valida el documento del plan en el momento de capturarlo: cada slice tiene que nombrar
la comprobación automática que falla sin ella, o declarar por qué no hay ninguna sensata.

## Decisiones del ledger que lo moldean

- C1-D7 — la validación vive en la captura, que es el único punto por el que pasan los tres hosts.
- G2 — un documento bien formado nunca se encuentra con la guarda.

## Cómo va a funcionar

La captura rechaza el documento nombrando la slice incompleta; el orquestador la corrige
y vuelve a presentar el plan por la vía de cambio material que ya existe.

## Planning disposition

Phase 1 intent approved; phase 2 surface map completed; phase 3 ledger frozen (doubt pass: N/A —
no migration, security or rollback surface); phase 4 slicing completed with 3 slices in 2 waves,
widest width 2, execution mode SEQUENTIAL by the operator's own answer; phase 5 approval document ready.

## Slices

### Wave 1

- **S1 — the validator in the capture path.**
  Goal: a document whose slice names no automated check is refused at capture, by name.
  Files: `core/src/state/plan.ts`, `core/test/state/`.
  Verify: `npm test`; `npm run typecheck`; failing-check: a fixture document whose second slice
  names neither token, refused with that slice named, RED without the slice.
  Depends-on: nothing.

### Wave 2 (width 2)

- **S2 — the installer row that carries the refusal to the two hosts.**
  Goal: both host renders arm the same refusal from the same core.
  Files: `core/src/install/`, `opencode/dist/oso-code.js`.
  Verify: `npm run build`; `npm run check`; failing-check: an install verification row that goes
  red on a render whose capture path skips the validator.
  Depends-on: S1.
- **S3 — the release note.**
  Goal: the change is readable in the changelog before anyone meets the refusal.
  Files: `CHANGELOG.md`.
  Verify: Verify-exception: prose only, and no automated check over a changelog entry is sensible.
  Depends-on: S1.

## Verification bar

`npm test`; `npm run typecheck`; `npm run build`; `npm run check`.
