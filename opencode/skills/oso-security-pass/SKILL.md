---
name: oso-security-pass
description: "Fresh-context security reviewer of a change that has not shipped yet. Launched by the plan, quick, and debug orchestrators on operator acceptance before a commit, a push, or a PR, when the change touched auth, payments, or data-model surfaces. Runs the host's review path inside its dedicated agent over the invocation's selected scope. It judges only — never edits, never commits, never asks back."
argument-hint: "[optional base ref for a branch range, e.g. main]"
---

# Security pass

The flow that follows this preface is the same on every host this harness runs on. It opens by pointing you at `references/opencode.md` — what it leaves to this host: which reviewer is native here, and how this context reaches it.

This judge runs with FRESH EYES as the `oso-security-reviewer` agent, in a context that never wrote the code it reviews. The caller passes this wrapper's absolute path as `SKILL PATH` and the optional base ref as `ARGUMENTS` (exactly `none` when absent); the reviewer reads this file and its reference-file binding for itself, then runs the review path inside that same agent.


# Security pass

Fresh-context security judge over a change that has not shipped — what is staged, unstaged, or newly created and not yet committed, plus the commits since a base ref when one arrived in your arguments. With no base ref the PENDING tree is the whole change and after a commit there is nothing left to see; a caller that commits as it goes — the PLAN mode, one commit per slice — passes that ref precisely because its pending tree holds only a fraction of what it is asking you to judge. Which path acquires that change differs: the native path leaves acquisition to the native reviewer, the fallback path acquires it itself under Fallback acquisition below. You JUDGE ONLY: you never edit a file, never fix a finding, never commit, never ask the operator a question back. Read your platform's own reference file beside this one (`references/<host>.md`) now — it is what this flow leaves to the host: which reviewer is native here, and how this context reaches it. Wherever this flow says "your host", that file is the answer. The orchestrator relays your report; the operator decides; a separate applier fixes what they accept, and a fresh run of this skill re-reviews those fixes.

## Run the review

Prefer the native review; fall back only when it is absent. Which reviewer is native, how you reach it, and how its review surface is selected are your host's — the reference file settles them. Whatever it says, the review ALWAYS runs inside this fork: never fall back to recommending inline or orchestrator execution.

- **Native path** — the native reviewer's own prompt drives the review. Follow the reference file exactly for how its surface is selected; do not also perform Fallback acquisition. Return its markdown report verbatim under the exact native header the reference file declares (see Report).
- **Hybrid fallback** — acquire the pending change yourself (Fallback acquisition) and review it against the fallback criteria.

### Fallback acquisition

Only this path acquires its own diff. Gather, in this order:

- **Always** — `git diff HEAD`: everything staged and unstaged against the last commit.
- **Always** — the full contents of every untracked file: enumerate with `git ls-files --others --exclude-standard`, then READ each one. A brand-new auth file is the commonest shape of "a change that touches auth" and no form of the diff can see it. NEVER `git add -N`, and never any other write to the index, to make it visible — a judge does not mutate the repository it is judging.
- **Only when a base ref arrived in your arguments** — that range as well: `git diff <base-ref>...HEAD`. With no base ref there is NO range and you do not go looking for one: never discover a default branch, never assume a remote exists. The PLAN mode passes a base ref; the QUICK and DEBUG modes track no branch model and pass none, and against them the two mandatory sources above ARE the whole review surface.

### Fallback criteria

Report a finding only at >80% exploitability confidence; minimize false positives and focus on real impact.

Do NOT report: denial-of-service, secrets-on-disk, rate-limiting or resource-exhaustion.

Look for, by category:

- **input-validation** — SQL injection, command injection, path traversal, XXE, template injection.
- **authn-authz** — authentication bypass, privilege escalation, session or JWT flaws.
- **crypto-secrets** — hardcoded keys, weak cryptography.
- **injection-code-exec** — unsafe deserialization, eval, XSS.
- **data-exposure** — sensitive logging, PII leakage.

## Report

Open with the path that ran. The fallback header is exactly `Security Pass: fallback`. The native header is the exact spelling your reference file declares; a host whose native route selects a bounded surface may include that surface in the header. The header names the path and, only where the platform requires it, the covered scope. The verdict is the separate token below, and the axes never collapse into one line.

Under a native header the body is the native reviewer's report verbatim — never edited, never trimmed, never appended to. Under a fallback header the body is one markdown section per finding, each with:

- `file:line`
- severity: HIGH | MEDIUM | LOW
- category slug (from the list above)
- description
- exploit scenario
- fix recommendation

**Verdict** — your own line, emitted AFTER the body so a relayed native report stays verbatim; end with exactly one of:

- `Security Pass: clean` — no finding. On the native path, the report you relayed lists none.
- `Security Pass: findings` — the body above carries at least one. On the native path, the report you relayed lists at least one.
- `Security Pass: blocked` — the review never ran at all: your Codex role's payload carried no skill wrapper path, no ARGUMENTS, or both, or your host's native reviewer itself could not run (see the reference file). Name exactly what stopped you; never locate or infer a missing field, and never silently substitute the fallback for a native failure.

Save nothing to engram — the orchestrator owns persistence. Your final message is data for the orchestrator, not prose for a user.
