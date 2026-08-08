# Roadmap mode

Guided flow for a QUEUE of changes. The operator decides the queue and the decisions that shape it once, up front; the flow then carries each change as far as those decisions carry it — to its close, or to the set-aside §3 describes when one they never answered surfaces — without coming back to ask again.

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

The exchange that produces them runs in question rounds: which tool asks them and how many one round may hold are the platform file's, and it names both. Each question takes the shape the PLAN mode's decision rounds already require — 2–4 concrete options with their tradeoffs, your recommendation first with why it wins and whether it is current standard practice, and current docs checked before recommending anything that turns on an external library — because these are the same decisions, asked once over a queue instead of once per change.

**Each child carries three fields, and a child missing one is not queued yet.**

- **Intent** — what that change delivers, one abstraction level above code. It is settled HERE: the PLAN mode's §1 iterates an intent until the operator approves it, and a child planned unattended has nobody there to give that approval, so this exchange is where it is given and §3 is what gives it.
- **Mode** — PLAN. It is the only mode this version queues, per the ground rules above, and an ask that belongs in QUICK or DEBUG meets here the answer the PLAN mode's own phase 1 gives it: say so, offer that mode, and the operator decides — never carry it into the queue to be discovered when the chain reaches it.
- **Whether it already carries an approved plan** — a child whose ledger was frozen, whose slices were cut and whose plan was approved in an earlier run of the PLAN mode executes as approved; a child arriving with an intent alone is planned unattended under §3's approval. Which of the two a child is decides how much work stands in front of it, so it is recorded here rather than inferred later.

**The global ledger** holds a decision the operator would otherwise take again in every child's rounds: the same answer to the same core lens — Contracts, Architecture, Errors, Verification, Reuse, the PLAN mode's §3 invariant core — across all or most of the children. Every entry names the children it applies to, and an entry that applies to most of them names the ones it does not; all-or-most is a usable scope only when the exceptions are written where a child's own planning reads them.

What a global entry then does to that planning has three parts and no fourth:

- **Inheritance** — an entry that answers a question a child's own rounds would ask pre-answers it, and that child's ledger records the answer as INHERITED, naming the global entry it came from. Nothing re-derives it and nothing asks it again.
- **Precedence** — a per-child decision from this phase overrides a global entry for that child and for no other. The narrower decision wins because it was taken about that child specifically.
- **Reconciliation** — an inherited decision the child's own evidence contradicts is a RECONCILIATION: never silently resolved, neither by the entry standing over the evidence nor by the evidence quietly replacing the entry. What answers one is §2's, not this phase's.

**Where this phase's output lives.** The roadmap persists as engram topics under the index format standard the PLAN mode's §5 states — this mode adds no second standard and spells no key any other way. `{roadmap}` is a short kebab slug, the way `{change}` is:

- `oso/{roadmap}/ledger` — the roadmap's own record: the queue in order with each child's three fields, the global ledger entry by entry with each entry's scope, and each child's own decisions under that child. Saved once at this phase's exit — `mem_save(title: "oso/{roadmap}/ledger — {human description}", topic_key: "oso/{roadmap}/ledger", type: "architecture", capture_prompt: false, content: the queue + the global entries + each child's decisions)`, content and title in English — and every later touch is a `mem_update` that merges, never overwrites. §2's policy joins it at that same key, so one topic answers what was decided about the whole roadmap.
- `oso/index` — one row for the roadmap, status `roadmap`, written at §3 when the approval makes the roadmap real (`mem_save` to create the index if it does not exist yet, `mem_update` to merge the row when it does — never overwriting another change's row). It lists every child in run order by the LITERAL topic key that child's own flow writes (`oso/{child}/plan`), never a wiki-link, per that standard's detail-column rule. A child the chain has not reached carries no such observation yet, and the ledger topic above is that child's record until its own flow writes one. The rich title and the `NEXT:` line move with the row, and the `NEXT:` line is where the roadmap's position lives — the standard's own example already writes one that way.
- Each child keeps its normal per-change topics — `oso/{child}/ledger`, `oso/{child}/plan`, `oso/{child}/summary` — plus its own index row, all written by its own flow. The parent adds a row and replaces none of theirs: `roadmap` marks a row as a parent rather than reporting progress, so how far the roadmap has got reads off the children's rows and that `NEXT:` line.

Exit: every child carries its three fields, every global entry carries its scope, every child carries its own decisions or an explicit none, and the ledger observation is saved. Nothing is approved yet — §2 declares the policy over this queue, and §3 is the one gate.

## 2. The autonomy policy

A decision will surface after the operator has gone; an unattended chain guarantees it rather than risking it. The policy is what answers such a decision, and it is DECLARED here, before the approval, so the answer is one the operator agreed to rather than one the flow improvised on their behalf.

It has two outcomes and no third. A decision the policy resolves is taken and RECORDED AS DELEGATED, naming the policy that decided it. A decision that structurally needs the human is QUEUED for §5 and the chain moves on — queuing never blocks it, and nothing queued is answered by guessing.

Once declared, the policy is saved into the roadmap's ledger topic at §1's key — a `mem_update` that merges it in beside the queue and overwrites nothing there.

## 3. Approval — once, for the whole roadmap

§1's queue and §2's policy go to the operator as one document, and their approval covers the planning behind it and the execution of every child in it. What the approval gate IS on this host, and what passes it, is the platform file's.

What that one approval authorizes:

- **Planning every child that arrived with an intent alone** — unattended, through the PLAN mode's own phases, on the intent §1 settled and against the global ledger §1 froze. That mode's freeze needs no exception carved for this one: its reconciliation checklist asks every question to map to a ledger decision, a delegated mark or an N/A with a reason, and both answers this mode supplies are already one of those — an inherited entry is a ledger decision recorded as inherited, and a decision §2's policy took is the delegated mark that phase already writes. §2's other outcome supplies no answer to map: a question it queues is a question nobody answered, so that checklist refuses the freeze over it exactly as it would with the operator in the room. That refusal is a bound on this approval, never an exception cut into the gate, and the last bullet below is where it lands.
- **Executing every child** — the ones planned under this approval and the ones that arrived carrying a plan of their own already approved, in the order §1 recorded.
- **Deciding exactly what §2's policy resolves**, recorded as delegated and naming the policy that decided it.

What it does not:

- **A child, or an intent, this document does not carry.** A queue that changes materially after presentation — a child added, an intent redrawn, a global entry reopened — invalidates the approval: re-present the whole document and pass the gate again for fresh approval, the rule the PLAN mode's §5 states about its own plan.
- **A child's own plan document.** Every child planned here still builds and delivers the Repaso-headed plan document the PLAN mode's §5 produces — it is what the operator reads to see what this approval actually bought — and where a host's rail stops at each child, that document is what the rail waits behind; the platform file states where it stops and what releases it. This approval covers that document's approval where the host asks for none; it never replaces the document. A child the last bullet below sets aside while it was still being planned is the one exception, and it is no gap: nothing was frozen there, so there is nothing to present and nothing to execute.
- **A decision §2's policy cannot resolve.** That one is queued for §5 and the chain moves on. An approval already given is no licence to answer it, and nothing between here and §5 goes and fetches the operator to answer it either — so what a queued decision costs is paid by the CHILD it surfaced in, never by the chain, which arms the next one either way. What that child pays turns on where the decision surfaced and on whether the child's own progress was waiting on it:
  - **Queued while a child is still being PLANNED**, it stops that child where it stood: the checklist above refuses the freeze, this approval authorizes no way around that refusal, and the child is SET ASIDE — carried no further, never executed — while the chain arms the one behind it.
  - **Queued while a child is EXECUTING, over something its progress does not wait on**, it costs that child nothing. The PLAN mode's own execution-time decisions of that shape are OFFERS — stopping the line for breakage the slice did not cause, the exit back to sequential, the security review at the close — and an offer nobody is there to take is an offer not taken, which that mode's own route for a declined offer already covers. The child runs on to its close, no frozen decision of its ledger is reopened, and the item travels to §5.
  - **Queued while a child is EXECUTING, over something its progress DOES wait on**, it cannot be free, and this mode pretends otherwise nowhere. A question the frozen ledger does not answer stops the slice that hit it, and a second attempt over that same unanswered ledger stops in the same place; a divergence between the code and a decision is the operator's to read, and that child's own close will not go green while one stands open. Such a child is SET ASIDE mid-execution: the slices it already landed stay as its own execution left them — committed, where that child's ledger kept per-slice commits on — the ones behind them are never executed, and the chain arms the next child rather than standing in front of a stop only the operator can clear. It is the same disposition the planning case above ends in, and §4's arming releases on both. Which of the PLAN mode's own routes carries such a child there is that mode's to state, never this one's.

  Every decision queued here, and every child a queued decision set aside, reaches §5.

Passing the gate is what makes the roadmap real, so it is here that `oso/index` gains the roadmap's row, in the shape and the vocabulary §1 spells for it.

## 4. The chain

Each child runs as its own PLAN-mode change — planned, executed and closed, or set aside at whichever of those a queued question reached it in — and the next one arms only once the one before it has closed or was set aside, the way §3's last bullet describes. What this mode adds to that one is what crosses the boundary between children — the approved queue, the global ledger, the position the roadmap has reached — and what each child inherits from them when it starts.

## 5. The presence phase

Everything §2 queued instead of answering is consolidated here and presented once, at the end: each item with the child it came from and the point in that child where it arose. This is the flow's one return to the operator after §3, and it is what lets a decision that needs them cost the chain nothing at the moment it arises.
