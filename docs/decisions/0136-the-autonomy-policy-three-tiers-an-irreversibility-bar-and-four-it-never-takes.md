# 0136 — The autonomy policy: three tiers, an irreversibility bar, and four decisions it never takes

Date: 2026-08-10
Status: accepted
Reconciled: applied — `docs/blueprint.md`'s Mode 4 phase 2 states the ladder, the bar and the list. The policy itself is declared in `plugin/skills/_shared/bodies/roadmap.md` §2 and saved into the roadmap's own ledger topic beside the queue; `bodies/plan.md`'s ground rules bind a child to it and route every point of that flow that would put a decision to the operator through it; `plugin/output-styles/oso.md`'s decision rule names the one case that answers in their place; and `tests/plugin-lint.sh` holds both halves — `check_roadmap_autonomy_policy_declares_its_ladder_and_its_bar` over the phase's own clauses, and `check_roadmap_condition_never_loosens_the_operator_rule` over the two texts that hand a decision to the operator, which must keep that instruction absolute while naming the condition that bounds it.
Source: this change (roadmap-auto-mode); the structural certainty that a decision surfaces after the operator has gone — an unattended chain guarantees it rather than risking it — and the requirement that whatever answers it be something they agreed to before leaving

## Decision

**What answers a decision in the operator's absence is DECLARED before the approval, never improvised after it.** The policy has two outcomes and no third: a decision it resolves is taken and RECORDED AS DELEGATED, naming the policy that decided it; a decision that structurally needs the human is QUEUED for the presence phase and the chain moves on. Queuing never blocks the chain, and nothing queued is ever answered by guessing.

### Part 1 — the policy answers the residue, never the record

Most of a roadmap's decisions are taken in phase 1, deliberately, so what reaches the policy is what those ledgers leave. The order is fixed and the policy is last: a per-child decision from phase 1 answers first because the narrower decision wins; where there is none, the global entry the child records as INHERITED has already answered before any round of the child's own could ask; and the ladder below is reached only for a question neither of them answers.

One case is no tier's at all. An inherited entry the child's own evidence contradicts is not a missing answer but two answers, and choosing between them is the operator's — so a RECONCILIATION takes the queued outcome the way everything else this policy will not decide does.

### Part 2 — three tiers, each reached only when the one above has nothing to say

- **The flow's own recommendation, first.** Where the decision can be put the way phase 1's rounds and a child's own decision rounds are both already required to put one — options with tradeoffs, the recommendation FIRST with why it wins and whether it is current standard practice, current docs checked before anything turning on an external library is recommended — that recommendation is the answer. The tier invents nothing: running unattended changed only who was there to read what those rounds produce anyway. A recommendation that could not be justified in those same terms, on the evidence in front of the flow, is not one — the tier stays silent rather than dressing a coin toss as a recommendation.
- **Current standard practice, next.** Where the tradeoffs do not separate the options, what practice standardly does decides, established the way the tier above would have had to establish it: against current docs wherever an external library, framework or API is what the choice turns on, never from a memory of one. The tier above must already SAY whether its recommendation is standard practice, which is what makes this the tier beneath it rather than a rival to it.
- **Simplest for the operator, last.** Where practice standardizes nothing, or standardizes two things equally, the option that costs the operator least to live with wins: fewest moving parts, least to learn, least to keep working. Simplest to IMPLEMENT is a different question and this tier never answers it.

Whichever tier answers, the answer is recorded in vocabulary that already exists: the delegated mark Mode 1's phase 3 writes for a decision handed to the flow, its rationale naming the tier and why that tier was the one reached. No second shape for recording a decision is introduced, because that mark is exactly what a child's own freeze reconciles against.

### Part 3 — the irreversibility bar, and one question decides it

A tier's confidence is not an undo. One question separates what the policy may decide from what it may not: **if this answer is wrong, does undoing it need more than an edit and a re-run in this repository?** An undo needing a restore from a backup, a refund, a revocation, a retraction, or another person is over the bar — a destructive migration, deleted data, spend or a commitment to spend, an external signup. Over the bar the policy DEFERS: the decision takes the queued outcome and no tier is consulted for it at all.

The bar governs what this POLICY decides and never what the operator already decided. A destructive step phase 1's ledger settled is their own decision, and carrying it out is what the one approval covers.

### Part 4 — the never-solo list, fixed at four

None of the four is a new refusal. Each is already refused where it lives, and the list stands in the policy so that a DECLARED policy can never be read as covering them:

- **A push, a PR, or a release** — Mode 1's close holds the push and the PR for the operator to ask for (ADR-0093), and its per-slice commit says in the same breath that it is a commit and never a push.
- **A ledger amendment** — a frozen decision is amended through the conformance triage `bodies/plan.md` §7 step 3 runs over ADR-0048's second axis, where the operator, never the flow, picks the amendment over the other reading, because that ledger is the reviewer's evidence for the code it judges.
- **Accepting a security residual** — the review at that close ends in fixes the operator accepted or a residual the operator explicitly accepted; both are theirs to give (ADR-0045).
- **A forced deletion** — that close names to the operator any removal git refuses instead of forcing it, over the worktree and branch lifecycle ADR-0088 settled, and takes a branch out with `-d` and never `-D`.

## Context

An unattended flow with no declared policy has exactly two failure modes and both were unacceptable. It can stop at the first decision it meets, which turns "decide once and walk away" into a chain that gets one child in before it waits for somebody who is not coming. Or it can decide whatever it likes and report afterwards, which is the assumption the whole harness is built against — the output style's own decision rule, the plan flow's never-assume clause, and the applier's blocked report all exist to keep a model from picking a default.

The way out is that the operator declares the ladder BEFORE the approval and the approval covers it. That makes an answer taken in their absence one they authorized the shape of, and it makes the audit possible: the presence phase's report replays every delegated decision with the tier that answered it, so an operator can read what their own policy actually bought.

The bar is one question rather than a taxonomy of dangerous operations because a list of operations is a list somebody has to keep current, and the first operation it misses is decided by a tier that never noticed the list was short. "More than an edit and a re-run in this repository" is answerable about an operation nobody enumerated in advance.

## Consequences

- The three tiers are a ladder, not a vote: a tier is consulted only when the one above it is silent, so two tiers never disagree and no tie-break rule is needed. The cost is that the first tier has to be honest about its own silence — a recommendation it cannot justify on the evidence must not be produced — and that honesty is the load-bearing part of the whole ladder.
- Nothing the policy decides is recorded in a new place or a new shape. The delegated mark was already the record for a decision handed to the flow, so a child's ledger reads the same whether the operator was in the room or the policy stood in for them, and the sweep's conformance axis judges it the same way.
- The never-solo list is fixed at four and each item is refused elsewhere too, so the list is a reading aid rather than the enforcement. If a fifth such refusal is ever added to a flow, this list has to grow with it or a declared policy starts looking like a licence.
- The bar makes the policy deliberately conservative in one direction only: it defers on irreversibility even where a tier would plainly have answered. A deferral costs the child it surfaced in (ADR-0137) and the operator one item in a queue; a wrong irreversible answer costs a restore.
- The output style's decision rule and the plan body's applier-blocked route now carry a condition where they used to carry an absolute. Both keep the absolute word for word and name the roadmap that conditions it plus the queued outcome that bounds what the condition buys, and a lint rule holds that shape — an unconditioned "never assume" was the correct instruction for the three modes that have an operator standing at them, and it stays exactly that for them.
