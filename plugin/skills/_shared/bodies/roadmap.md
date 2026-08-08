# Roadmap mode

Guided flow for a QUEUE of changes. The operator decides the queue and the decisions that shape it once, up front; the flow then carries each change through to its close without coming back to ask again.

## Ground rules for the whole flow

- Every child of a roadmap is a PLAN-mode change, and nothing else is queued here. A roadmap is a sequence of substantial changes decided together, never a list of small fixes with a queue drawn around it — an ask that belongs in the QUICK or DEBUG mode belongs there whether or not it arrived beside four others.
- The exchange with the operator is §1 through §3; everything after it runs on what that exchange recorded. That split is the whole trade this mode offers, and it is why the decisions are taken in one sitting: the chain does not stop for what was already decided.
- ONE approval covers the whole roadmap — the planning behind it and the execution of every child in it. Where a host's own rail requires more than that one, the platform file states exactly where the chain stops and what releases it; it is the only place that answer is written.
- Operator-facing content — the queue as it is planned, the approval document, the presence phase at the end — is delivered under your host's delivery contract, stated in the platform file.
- Milestone reporting — a child armed, a delegation launched on the operator's behalf, a verdict read, a judge's outcome, a child closed: report each under the milestone contract at `_shared/reporting.md`, the single source for what each moment states and how long it may run. An unattended run is the case that contract was written for — nobody is in the exchange, so what the flow says as it goes is the whole of what the operator gets.

## 1. The queue — planned with the operator

Three artifacts come out of this phase, and §3 approves them together:

- **The children, in order** — each one a change the PLAN mode could take on its own, and the order they run in.
- **The global ledger** — the decisions that hold across the whole roadmap, taken here once instead of once per child.
- **Each child's important decisions** — the ones that shape that child alone and would otherwise surface mid-execution, with nobody there to answer them.

## 2. The autonomy policy

A decision will surface after the operator has gone; an unattended chain guarantees it rather than risking it. The policy is what answers such a decision, and it is DECLARED here, before the approval, so the answer is one the operator agreed to rather than one the flow improvised on their behalf.

It has two outcomes and no third. A decision the policy resolves is taken and RECORDED AS DELEGATED, naming the policy that decided it. A decision that structurally needs the human is QUEUED for §5 and the chain moves on — queuing never blocks it, and nothing queued is answered by guessing.

## 3. Approval — once, for the whole roadmap

§1's queue and §2's policy go to the operator as one document, and their approval covers the planning behind it and the execution of every child in it. What the approval gate IS on this host, and what passes it, is the platform file's.

## 4. The chain

Each child is planned, executed and closed as its own PLAN-mode change, and the next one arms only once the one before it has closed. What this mode adds to that one is what crosses the boundary between children — the approved queue, the global ledger, the position the roadmap has reached — and what each child inherits from them when it starts.

## 5. The presence phase

Everything §2 queued instead of answering is consolidated here and presented once, at the end: each item with the child it came from and the point in that child where it arose. This is the flow's one return to the operator after §3, and it is what lets a decision that needs them cost the chain nothing at the moment it arises.
