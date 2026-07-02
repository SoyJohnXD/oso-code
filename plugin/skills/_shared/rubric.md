# oso-code rubric

Shared quality bar for `quality-pass` and `debt-sweep`. Derived from clean-code-standards (gentleman-programming, Apache-2.0). Apply to touched code only — never untouched files.

## Judgment contract — read first, it overrides every rule below

The rubric serves readability; readability never serves the rubric.

- Every finding must state the concrete readability win of its fix. A finding justified only by "the rule says so" is not a finding — drop it.
- If applying a rule makes the code harder to read, do not apply it, and record why in the report.
- Verify before flagging: read the surrounding code and confirm the "violation" is not already the clearest available shape.

## Hard blockers — any one fails the gate; the judgment contract cannot override these

- A hardcoded secret, credential, token, or private key.
- An error swallowed silently or replaced by a generic catch-all that loses the cause.
- A new abstraction (wrapper, factory, registry, config object) with no current caller.

## File level — check every touched file

- Names carry domain intent and read without opening the body; no vague generics (`data`, `item`, `handler`, `utils`) and no type-echo noise words.
- Files read top-down (step-down): high-level function first as a table of contents, steps below in call order, one abstraction level per function.
- Guard clauses over nested decisions; control flow stays flat — never a pyramid.
- No magic values: behavior-changing literals are named once, at the narrowest scope that covers all their uses. Over-extraction is a violation too:
  - Only behavior-changing literals earn a name — never one-use or self-evident values.
  - A constant lives next to its use; a pile of constants hoisted to the top of the file "for order" is the violation, not the fix.
  - Compose constants from existing ones (`` `${API_BASE}/users` ``) instead of repeating a value fragment across several.
  - Before creating a constant, search for an existing one with the same value and meaning — reuse it or compose from it.
- Prefer the language's modern idioms when they read better: optional chaining, nullish coalescing, spread/rest, destructuring, and array methods over manual loops and if-ladders. Guard clauses flatten control flow — they are not a mandate to expand a clear expression into a chain of ifs.
- No long positional parameter lists; use a parameter object, and model data clumps as named types.
- Illegal states are unrepresentable: mutually exclusive variants are discriminated unions, not boolean flags or optional fields.
- A little duplication beats a speculative abstraction: extract only a proven, stable shared seam; no wrappers, factories, or config objects without a current caller.
- Errors are specific and visible — never swallowed, never generic, never an ambiguous sentinel that collides with valid values.
- Business rules stay pure (data in, decision out, no IO); IO lives at the edges and the dependency points inward.

## System level — check the change as a whole

- No cross-file duplication introduced by the change: the same rule, helper, or mapping written twice in different files.
- Dependency direction holds: domain code never imports infrastructure, UI, or framework glue.
- Primitives are reused: the change uses existing helpers, error types, shared types, and existing constants instead of recreating them — no two constants with the same value and meaning across the change.
- No god-module growth: no file quietly absorbed responsibilities that belong elsewhere.
- One style per concern: the change follows the codebase's existing pattern for a concern instead of introducing a competing one.
- Logic lives in its layer: validation, normalization, and calculation helpers belong to the domain layer — not scattered through UI or component folders.

## Debt markers — none may remain

- Dead code: unused imports or exports, unreachable branches, commented-out blocks.
- Leftover debug output, temporary flags, or stray TODOs without an owner.
- Over-documentation. The default is ZERO comments — naming and structure carry the meaning:
  - JSDoc is the exception, not a habit: only on code whose behavior or contract cannot be made obvious from names and types alone (non-trivial algorithms, surprising edge semantics like float rounding, external or legal constraints).
  - When JSDoc is earned, use the standard shape: one-line description, then `@param`/`@returns` only where they add meaning beyond the types (units, ranges, invariants).
  - A why-shaped sentence over self-evident code is still a WHAT comment — dressing noise as rationale does not save it. If a one-line function needs a comment, fix the name instead.
  - Scarcity check: if most exports in a file carry JSDoc, that is over-documentation and a violation in itself.
