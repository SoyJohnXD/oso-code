# Repaso de cambios

## Qué se va a realizar

Se cierra el bloque de la última slice donde empieza la siguiente sección. Hoy ese bloque
llega hasta el final del documento, así que cualquier línea escrita por debajo de las
slices lo satisface sin que la slice diga nada.

## Decisiones del ledger que lo moldean

- C1-D7 — cada slice nombra su comprobación automática o dice por qué no hay ninguna.
- G2 — un documento bien formado nunca se encuentra con la guarda.

## Cómo va a funcionar

El bloque de una slice termina en el siguiente encabezado de su mismo nivel o de uno
superior, nunca en el final del documento.

## Planning disposition

Phase 1 intent approved; phase 2 surface map completed; phase 3 ledger frozen (doubt pass: N/A —
no migration, security or rollback surface); phase 4 slicing completed with 2 slices in 2 waves,
widest width 1, execution mode SEQUENTIAL; phase 5 approval document ready.

## Slices

### Wave 1

- **S1 — the slice block ends where the next section starts.**
  Goal: the last slice's block stops at the next heading rather than at the end of the document.
  Files: `core/src/state/plan.ts`.
  Verify: `npm test`; failing-check: this document, captured today and refused once the block is bounded.
  Depends-on: nothing.

### Wave 2

- **S2 — the fixture that reads below the last slice.**
  Goal: the refusal answers to the slice's own Verify line rather than to the document around it.
  Files: `core/test/fixtures/plan-documents/`.
  Verify: `npm test`; `npm run typecheck`, both green over the two fixtures.
  Depends-on: S1.

## Verification bar

The bar re-runs each slice's failing-check: line after the merge.
