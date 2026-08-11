# 0142 — The verifier's payload is a closed list, and its inline-comment gate is empirical

Date: 2026-08-10
Status: accepted
Reconciled: elsewhere — both hosts' verifier contracts carry it and the frozen body names two payload coordinates and claims no exhaustiveness, so the field list was never its to close. `plugin/agents/oso-verifier.md` declares its fields a CLOSED list in the opening paragraph, names the three shapes that arrive past it — a standing ruling, a project convention offered as an input, any instruction that softens a gate or pre-judges a criterion — routes each to `blocked`, states that a project's conventions are an APPLIER input and never a verifier one, and adds the decisions the work implements to the legitimate set beside the zero-warnings commands; the payload-overstep trigger is admitted at all three of its sites that enumerate a cause, both report shapes' `reason:` lines and the closing paragraph. `codex/agents/oso-verifier.toml` states the same list with `HANDOFF SLICE` and `HANDOFF ATTEMPT` carved out by name as the transport envelope its own closing rule already answers, and widens its `blocked` definition to the refused case. Both contracts' inline-comment gates now RUN a scan of the slice diff and CITE its command and output as verdict evidence, judging every hit. `tests/plugin-lint.sh`'s `check_verifier_payload_is_closed_and_its_comment_gate_scans` holds both hosts, and `tests/hooks-test.sh` takes its mutation case at 1395 → 1396.
Source: this change (authority-plan-auto); the same wimm-web field failure ADR-0141 records, read from the receiving end — eleven-plus verifier payloads carrying a standing ruling that told the judge not to fail on the inline-comment rule, every one of them honored

## Decision

**The fields a verifier's payload carries are a CLOSED list, and its inline-comment gate is EMPIRICAL.** A payload carrying anything past the list is an error the verifier returns as `blocked`; a verdict on a slice whose diff was never scanned is not a verdict either contract accepts.

### Part 1 — closed, and closed at both ends of the list

Both contracts already enumerated what the orchestrator hands over. Neither said the enumeration was exhaustive, and an enumeration that does not say so is read as a floor: everything named arrives, and anything else that arrives is extra instruction to honor. That reading is what made the standing ruling work. The list is now closed by its own sentence, and three shapes are named as the ones that arrive past it — a standing ruling, a project convention offered as an input, any instruction that softens a gate or pre-judges a criterion.

Two clauses keep the closure from being either false or unusable:

- **The transport envelope is carved out by name.** `HANDOFF SLICE` and `HANDOFF ATTEMPT` are not assignment fields and never were; they ride beside the assignment so the Codex contract's own closing rule can echo them back as `oso-handoff:`. Without the carve-out the closure would make every Codex handoff a `blocked` report, which is the rule failing on its own host.
- **The ledger decisions are named INSIDE the list.** The Claude contract described the zero-warnings commands as what the ledger supplies and left the decisions relevant to the slice unnamed, while its own unledgered-abstraction gate cannot run without them and `bodies/plan.md` §6 step 3 has always handed them over. Closing a list that omits a field the flow genuinely sends turns a correct payload into a refused one. The field was already arriving; what changes is that the contract now says so.

**A project's conventions are an APPLIER input and never a verifier one.** This is the sharpest edge of the closure and it is stated as its own sentence, because a convention is the most legitimate-looking thing a payload can carry: it is true about the repo, the applier really does need it, and handing it to the judge reads like context rather than like an instruction. But the gates judge against the rubric alone, so a convention reaching the judge can only do one thing — soften a rule the rubric holds — and ADR-0143 is where the conflict between the two goes instead.

### Part 2 — `blocked` gains a fourth trigger, admitted where the word is defined

`blocked` meant three things: the environment is broken, the zero-warnings commands are missing, a criterion cannot be verified. All three are "I cannot". The fourth is "I will not", and the two are different enough that the contracts say so — the Claude one in that phrasing exactly, the Codex one by opening its definition on "verification did not happen" and marking the last trigger as refused rather than impossible.

The trigger is admitted at every site that ENUMERATES the word's causes, not only where the closure is stated, because an agent filling in a `reason:` reads the line describing that field and a trigger declared four hundred words earlier is one it has to remember rather than one it can see. On Claude that is three sites — both report shapes' `reason:` lines, which spell their triggers out, and the closing paragraph. On Codex it is one: that contract's `reason:` lines read `<required only on blocked>` and enumerate nothing, so its closing definition is the only place a cause is ever listed, and it is the only place this one is added.

### Part 3 — the comment gate runs a scan and cites it

ADR-0134 Part 2 gave the per-slice verifier the inline-comment gate; what it did not give it is a method. "Fail the slice if its diff ADDS an inline comment" is satisfiable by reading, by skimming, and by not looking at all, and the three are indistinguishable in a verdict — which is exactly the state the field failure ran in, where the gate that did fire did so because that judge happened to look.

The gate is now empirical in three steps, and each is checkable in the verdict it produces: RUN a scan of the slice diff for added lines that open a comment, in whatever shape covers the languages present, since the gate is language-generic and no fixed pattern survives a host language nobody predicted; CITE the scan's command and its output as evidence, in the same `cmd:` / `exit:` shape the rest of the verdict's evidence takes; then JUDGE every hit — the banned class fails the slice, and only a hit shown to be the language's standard public-API doc form stands. A verdict on a slice whose diff was never scanned is refused by both contracts in the same sentence.

## Context

ADR-0141 binds what the ROUTER may write. This decision binds what the JUDGE may accept, and the two are not the same fix. A router bound alone still faces judges that honor anything in front of them, so the next orchestrator — a different model, a different session, one that never read that rule — reopens the hole from the other side. A judge bound alone still runs downstream of a router free to build the payload however it likes, and refusing a payload is a whole round's cost every time. Together the payload is governed where it is written and where it is read, and neither half is load-bearing on its own.

The empirical gate answers a second thing the field failure showed, which the closure alone would not have touched. Eighty-seven comment lines landed across four commits, and the standing ruling explains the payloads — it does not explain the verdicts that passed slices under it, because a judge honoring a ruling and a judge not scanning at all produce the same green. Making the scan a required, cited step separates them: a verdict with no scan evidence is now visibly incomplete, whatever the payload said.

One alternative was rejected. **Pinning a fixed scan pattern in the contract** — a `grep` the verifier runs verbatim — was offered and turned down on the gate's own premise. The rule is language-generic: it holds for a repo of Python, of Rust, of shell, of a language nobody here has written yet, and a pattern pinned to `//` and `#` would either miss a comment marker it never heard of or teach the judge that those two are the class. What the contract pins is that a scan RAN and that its command and output are in the verdict, which is the part a reader can check without knowing the language.

## The ledger of what the rule cannot check

`check_verifier_payload_is_closed_and_its_comment_gate_scans` locates each half by a substring and then asks its markers of the JOINED result, which carries two ceilings:

- **The payload half greps `CLOSED list` case-insensitively and tests all five markers against every matching line at once.** `plugin/agents/oso-verifier.md` has one such line, so on that host the five are effectively asked of the declaration itself. `codex/agents/oso-verifier.toml` has TWO — the declaration and the `blocked` definition that names "a field past the closed list" — so the `blocked` marker is already satisfied there by a line that is not the declaration, and a Codex declaration that dropped the word would still pass. The other four markers live on the declaration alone today and would fail if it lost them.
- **The gate half greps `inline comment` the same way**, and one line per file matches today, so the four scan markers are asked of the gate sentence itself. A second sentence mentioning the phrase would join the blob and the markers could then be met by the pair rather than by each.

Neither half reads the report SHAPES. Part 2's whole point — the trigger admitted at Claude's two `reason:` lines and at each contract's closing definition — is held by review, since a rule scanning for the trigger's words would match the declaration line that already carries them.

## Consequences

- A verifier that returns `blocked` on an overstepping payload costs the orchestrator a round and tells it exactly what it did — which is the cheapest possible outcome for this defect, and much cheaper than the alternative it replaces, where the payload is honored and the cost is every slice after it.
- The `blocked` verdict now covers a refusal as well as an impossibility. Both contracts keep "never probably fine" as the outer bound, so the word did not get looser; it got one more precise trigger, named at every site that defines it.
- The Claude contract's payload list gained a field it was already being handed. That is a correction to the contract, not a change to the flow: `bodies/plan.md` §6 step 3 has sent the ledger decisions since the unledgered-abstraction gate existed, and closing the list is what made the omission cost something.
- Every verdict now carries one more piece of evidence, and it is the cheapest one in the report — a scan of a diff the verifier has already fetched. What it buys is that a green on the comment gate is distinguishable from a green nobody looked for.
- A project whose conventions genuinely matter to a judgment has one route and it is ADR-0143's: the conflict becomes a question for the operator during planning. What is closed is the route where the convention arrives at the gate as an instruction, since a judge weighing a repo's habit against the rubric is a judge deciding something the operator never delegated.
