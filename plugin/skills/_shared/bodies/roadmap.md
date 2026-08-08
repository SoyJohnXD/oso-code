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

**The policy answers the residue, never the record.** §1 front-loaded most of these decisions deliberately, so what reaches the policy is what those ledgers leave. A per-child decision from that phase answers first — the narrower one wins, which is §1's precedence and not a second rule — and where there is none, the global entry that child records as INHERITED, naming the entry it came from, has answered before any round of the child's own could ask. The ladder below is reached only for a question neither of them answers. §1's third part is the one no tier ever touches: an inherited entry the child's own evidence contradicts is not a missing answer but two answers, and choosing between them is the operator's, so a RECONCILIATION takes the queued outcome above the way everything else this policy will not decide does.

**Three tiers, and a tier is reached only when the one above it has nothing to say.**

- **The flow's own recommendation, first.** Where the decision can be put the way §1's rounds and a child's own decision rounds are both already required to put one — options with their tradeoffs, the recommendation FIRST with why it wins and whether it is current standard practice, and current docs checked before anything that turns on an external library or API is recommended — that recommendation is the answer. This tier invents nothing; running unattended changed only who was there to read what those rounds produce anyway. A recommendation you could not justify in those same terms, on the evidence in front of you, is not one — the tier is silent rather than dressing a coin toss as a recommendation.
- **Current standard practice, next.** Where the tradeoffs do not separate the options, what current practice standardly does in that case decides, established the way the tier above would have had to establish it: against current docs wherever an external library, framework or API is what the choice turns on, never from a memory of one. The tier above must already SAY whether its recommendation is standard practice, which is what makes this the tier beneath it rather than a rival to it.
- **Simplest for the operator, last.** Where practice standardizes nothing here, or standardizes two things equally, the option that costs the operator least to live with wins: the fewest moving parts, the least to learn, the least to keep working. Simplest to IMPLEMENT is a different question, and this tier never answers that one.

Whichever of the three answers, the answer is recorded in vocabulary that already exists: the delegated mark the PLAN mode's §3 writes for a decision handed to the flow, its rationale naming the tier that decided it and why that tier was the one reached. Nothing here adds a second shape for recording one — that mark is exactly what a child's own freeze reconciles against, per §3's first bullet.

**The irreversibility bar.** A tier's confidence is not an undo, so one class of decision is refused however plainly a tier would have answered it, and one question decides which: if this answer is wrong, does undoing it need more than an edit and a re-run in this repository? Anything whose undo needs a restore from a backup, a refund, a revocation, a retraction, or another person is over the bar — a destructive migration, deleted data, spend or a commitment to spend, an external signup, and whatever else is irreversible or externally visible. Such a decision DEFERS instead of resolving: it takes the queued outcome, and no tier is consulted for it. The bar governs what this POLICY decides and never what the operator already decided — a destructive step §1's ledger settled is their own decision, and carrying it out is what §3's approval covers.

**The never-solo list, fixed at four.** None of these is a new refusal; each is already refused where it lives, and the list stands here so a declared policy can never be read as covering them:

- **A push, a PR, or a release.** The PLAN mode's close holds the push and the PR for the operator to ask for, and its per-slice commit says in the same breath that it is a commit and never a push — a release reaches anybody only through one of those.
- **A ledger amendment.** A frozen decision is amended through that mode's conformance triage, where the operator — never the flow — picks the amendment over the other reading, because that ledger is the reviewer's evidence for the code it judges. Where a host's own rail lets an approved plan be amended at all, the operator's request or their one-line confirmation is what authorizes it, never a finding of the harness's own.
- **Accepting a security residual.** The security review at that same close ends in fixes the operator accepted or in a residual the operator explicitly accepted; both are theirs to give, and neither is the flow's to grant itself.
- **A forced deletion.** That close names a removal git refuses to the operator instead of forcing it, and takes a branch out with `-d` and never `-D`.

None of the four is a tier's question: each takes the queued outcome. What queuing then costs the child it surfaced in is §3's last bullet's to say, and it is said once, there.

Once declared, the policy is saved into the roadmap's ledger topic at §1's key — a `mem_update` that merges it in beside the queue and overwrites nothing there.

Exit: the three tiers, the bar and the never-solo list are declared and ready for the one document §3 presents, and the policy sits in the roadmap's ledger topic beside the queue. Nothing has been decided under it yet — the first decision it takes belongs to a child, past the one gate §3 is.

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
