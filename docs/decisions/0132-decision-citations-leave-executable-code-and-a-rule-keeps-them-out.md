# 0132 — Decision citations leave executable code, and a lint rule keeps them out

Date: 2026-08-07
Status: accepted
Reconciled: applied — every comment citation is gone from the six `bash -n` sets `ci.yml` covers, the two human-facing diagnostics that cited a decision as their authority name the fact instead, `Implemented-in:` is gone from all sixty-three decision files that carried it, `tests/plugin-lint.sh`'s bidirectional rule is narrowed to a reference-resolves check and joined by `check_executables_carry_no_decision_citations`, and `bodies/plan.md`'s verification-bar-coupling exemplar teaches the same lesson off the rule-count relation instead. `docs/decisions/0077`'s body still describes the retired relation as this repo's example of that edge: a decision body stays as written, so this file is where the retirement is recorded rather than there.
Source: this change (clean-bar-convergence); one real PR in which the applier transcribed this repo's own notation into a customer's TypeScript; ledger decision D4

## Decision

The house convention of citing a decision id in a comment leaves executable code, and a new lint rule keeps it out. Markdown PROSE keeps its `(ADR-XXXX)` references: a document naming the document that decided it is a cross-reference, not a comment.

### Part 1 — the purge, and where its boundary falls

Every decision-id citation in a comment is gone from every executable this repo ships. Executable means what the syntax gate already means by it — the six globbed sets `ci.yml` runs `bash -n` over, which between them are every shell script here plus the two files that carry no `.sh` extension — so one word covers both gates.

Three things the crude scan conflated are settled separately:

- A COMMENT citing a decision id: the id goes. Where the sentence around it still earns its keep the sentence stays, rephrased to name the fact rather than the record; where the id was the whole content, the comment goes with it. Every one of the hundred and fifty-five found here fell on the first side — each carried a reason the code cannot show — so none was dropped.
- A STRING LITERAL carrying an id stays where it is data or identity: the assertion that greps a flow body for prose keeping its own parenthesized reference must carry that reference verbatim, and a fixture that mutates a named decision file must name it. Neither is provenance about the code around it. Where a string IS provenance the id goes on the same terms as a comment's, and two did — a linter diagnostic and a suite failure message, each citing a decision as the authority for what it was asserting, both now naming the fact instead. The rule exempts every string either way, because its locator is the comment line; the provenance half of that exemption is held by review rather than by the check, and that is the whole of the distance between this boundary and the rule's reach.
- A rationale comment above a lint rule carrying NO id was never in this class and is untouched.

### Part 2 — one rule retires, one narrows, one arrives

The bidirectional rule is gone, and so are the `Implemented-in:` lines that fed it. Bookkeeping written from both ends costs an edit in a decision file for every citation a skill adds, and it was the half of the relation this change's own objection lands on. No `Supersedes:` line names its origin because there is none to name: the relation arrived with the decision-record scheme itself, in the release that created `docs/decisions/`, rather than as a decision of its own.

What remains is a reference-resolves check, renamed for what it now does. Deleting the rule outright was rejected: the prose this decision PRESERVES is thirty-six decision ids named across twelve markdown files, forty-three of those references in `bodies/plan.md` alone, and a decision renumbered or removed leaves every one pointing at nothing. No other check resolves one of these ids — the two rules beside it iterate the decision files that ARE there, so a missing file makes both quieter rather than louder. A dangling reference in a document is a real defect class, this change's objection was to citations in CODE and to the bookkeeping burden, and leaving a preserved class with no guard would trade a loud check for a silent gap.

The new rule is that check's inverse: no comment in an executable may cite a decision id. It scans the same six sets, spelled and ordered the way `ci.yml` runs them, on comment lines only, for the four notations this repo writes the reference in — the `ADR-` prefix, the `docs/decisions/` path, the id bare with nothing but its digits to mark it, and a change ledger's letter-and-digits tag. Both ceilings are stated where they live. The ledger tag's letter is held to the four these conventions have issued, because widening it to any capital was measured and flags innocent prose — a markdown heading level, a span inside a backticked character class, both already standing in these files — which would make the rule dictate prose rather than ban a citation. The bare form has no qualifier to mark it at all, so it is bounded to the hundreds this numbering has issued, which is what keeps it from reading four digits as an id: measured against the tree it flags nothing but the one citation it was widened to find, and the two shapes it would still flag — an all-digit commit prefix short enough to be four characters where every sha written here is git's own seven, a file mode written with a zero in that place — appear nowhere here.

Retiring one rule while narrowing it and adding one leaves the declared count at twenty-eight, one more than before, across all four surfaces that state it.

### Part 3 — the exemplar, and the boundary the registry states for itself

`bodies/plan.md` held this repo up as its own example of verification-bar coupling by describing the citation relation as a linted contract. That passage taught the convention to every applier that read it. The lesson is load-bearing and stays; the example is now the rule-count relation, which is the same edge — a slice that adds a rule and a slice that raises the count README states share no file and cannot pass the bar apart — and teaches nothing about citations.

`tests/plugin-lint.sh` states its own boundary in its own header. Its registry documents a reason above each rule, and that reason is the rule's specification — the defect it caught, what keeps it decidable, the ceiling it does not reach past — sitting above the function because a preceding block is the only place shell has for a contract a name cannot carry. The exemption is claimed there and NOWHERE in what the harness exports: the shared rubric's inline-comment class stays absolute for the code a change lands in a project, so a decision citation above a constant in a target project's source is exactly as indefensible as it was. What the registry's reasons and the exported bar agree on exactly is the citation, which the new rule enforces on this side.

## Context

The convention was load-bearing while the relation was checked, and the check was what made it look like a practice worth copying. It got copied: an applier reading these executables to learn the project's shell style carried the notation into a customer's TypeScript, where the ledger those tags name did not outlive the change that wrote it and never existed for that reader at all. Provenance belongs to the change's ledger, the PR body and the commit message — all three of which a reader can actually open.

Two alternatives were rejected. Keeping the convention behind an export boundary asks a writer to hold two rules for one shape and gives the reader of this repo no reason to believe the rule it exports; and purging markdown prose too would delete a working cross-reference between documents, which is not the defect and would leave the decision record unreachable from the prose that implements it.

## Consequences

- A rationale comment in an executable now names the fact rather than the record: "the identity is the absolute spelling", not the decision that settled it. A hundred and fifty-five comment lines carried an id and none does now, which is where this change's readability win actually lands — a reader gets the reason instead of a lookup.
- The new rule cannot describe the shapes it bans by example, because it scans its own file. Its reason spells them in words and leaves the notation to the pattern, which is the ban holding without an exception carved for the rule that states it.
- `docs/decisions/0077`'s body and older changelog entries still describe the retired relation. Both are records of their moment; the frontmatter that fed the check is what moved.
- A decision file's frontmatter is now `Date`, `Status`, an optional `Supersedes`, `Reconciled` and `Source`. Nothing in the repo needs a decision to enumerate its implementation, so nothing asks a writer to keep that list current.
