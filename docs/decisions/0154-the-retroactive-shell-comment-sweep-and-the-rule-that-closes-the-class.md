# 0154 — The retroactive shell comment sweep, the boundary it kept, and the rule that closes the class

Date: 2026-08-23
Status: accepted
Supersedes: ADR-0140's scope boundary alone — "The purge is scoped to the two test files. A wider one over `plugin/hooks/`, `bootstrap/` and `tools/` was offered and rejected" — and, with it, that decision's consequence that "a rationale block older than them stands until a sweep that names it". This is that sweep, and it names them. Everything else ADR-0140 decided stands: the per-rule rationale convention stays retired, its ledger of ceilings stays where it is, and ADR-0134's debt class, its three layers and its doc-form carve-out are untouched
Reconciled: applied — 3,852 comment lines are gone from the 36 shell files this repo ships (3,828 whole-line comments, 4 trailing ones trimmed off the code they sat behind, and 24 comments inside embedded awk and python programs that live in a shell string), 53 header lines are kept under the boundary below, `tests/plugin-lint.sh` gains `check_shell_sources_carry_no_comment_below_their_contract_header` and states its own rule count in the line it prints instead of in a header comment, `tools/hook-gates.txt` gains a `recovery` record kind so the one comment `tools/render-hooks-json.sh` read as data is data now, and `tests/hooks-test.sh` carries the mutation that turns the new rule red and the control that proves a heredoc body is not a comment
Source: this change (opencode-runtime-parity), slice 23; the operator, asked whether the repo's own convention or the rubric's no-exception class wins, choosing the retroactive sweep with its cost stated; measurements taken with a quote- and heredoc-aware parse of every shell file rather than a line grep

## Decision

**Every comment in a shell file this repo ships is gone, except one block per file and only where that file is not a program. A lint rule holds the boundary from here on.**

### Part 1 — the boundary, and why it is the file's own first byte

ADR-0134 put the inline comment outside the judgment contract's reach and ADR-0005's stack-translation clause left one carve-out: the host language's standard public-API doc form. Shell has no such form — no signature, no type, no doc syntax — so the question the operator was asked was whether the module-contract headers in `bootstrap/lib/` are that carve-out's shell equivalent or just the section banner's better-dressed cousin. ADR-0140's own Context already conceded half the answer: "a preceding block is the only place shell has to put a contract a name cannot carry. That is true of a contract; it is not true of most of what was written."

The distinction that survives is mechanical and needs no judgment at all:

- **A file that declares an interpreter is a program.** Its contract is its usage text, its flags and the messages it prints, all of which a reader can run and a test can assert. It carries no comment anywhere, its shebang aside.
- **A file that declares none cannot be run.** It exists only to be sourced, its API is the names it defines, and the block above its first line of code is the only place it has to say so. It may carry exactly one such block, and nothing below its first line of code.

Six files carry no shebang and keep one header each — `bootstrap/lib/install-backup.sh`, `bootstrap/lib/opencode-install-backups.sh`, `bootstrap/lib/opencode-trust-bytes.sh`, `bootstrap/lib/verification-fixtures.sh`, `plugin/hooks/lexer.sh` and `plugin/hooks/lib.sh` — 53 lines in all, four of which say "sourced, not executed" in so many words. Every other header went with the bodies below it, `tests/hooks-test.sh`'s and `tests/plugin-lint.sh`'s included.

The alternative boundary — one block at the top of ANY file — was rejected because it keeps the count claim `tests/plugin-lint.sh` carried, and a claim about a file's contents is the drift this class exists to stop. The alternative in the other direction — no block anywhere — was rejected on ADR-0140's own sentence: a sourced module has no runtime surface to state a contract on, and deleting the contract does not make the module self-explanatory, it makes it undocumented.

### Part 2 — the two comments a machine was reading, and where they went

The sweep could not simply delete a comment something read. Two were:

- **`tests/plugin-lint.sh`'s header carried the rule count**, and `check_present_tense_prose_names_the_rule_count` greps that file for the count word. The count now lives in the line the linter PRINTS — `lint: clean — fifty rules` — so the rule reads an executable string on its way to the operator instead of prose above the code. The check is unchanged and still bites: the surface list, the spelled-count table and the CHANGELOG half all read exactly what they read before.
- **Four PreToolUse gate scripts declared a `# Recovery:` header**, which `tools/render-hooks-json.sh` refused to render without. That declaration is a property of the GATE, and the gate table is where gate properties live and are written once. `tools/hook-gates.txt` grows a fourth record kind — `recovery <gate id> <the operator's legitimate next step>` — and the renderer's own parser enforces presence for every PreToolUse gate exactly as before, refusing a route for an unknown gate or for a gate that denies through another channel. The refusal message is byte-for-byte the one it printed before.

### Part 3 — the bar the sweep was held to

Not "it still passes". The full output of `tests/hooks-test.sh` was captured before the sweep and after it, `mktemp` paths normalized, and compared byte for byte: 1,785 lines, of which exactly ONE differs, and it is the name of the mutation case that now removes a table row instead of a header line. All 1,783 assertions, the counts and the one skip are identical text in identical order. That is the same discipline two earlier slices of this change used to prove a deletion behaviour-neutral, and it is the only bar that covers a change of this size, because nothing else reads 3,852 lines.

`bash -n` is clean over every scanned file, `tools/render-hooks-json.sh --check` renders the same three manifests, and `--check-hashes` matches all fifteen published hashes after `bootstrap/hook-hashes.txt` was re-rendered for the hook bytes that moved. That hash roll is the cost ADR-0140 named when it rejected the wider purge, and it is what the operator accepted when they chose the sweep.

## The ledger of what the comments carried

Most of what went restated the code, named a decision this log already holds, or described a defect its own decision file records in more detail. What no other artifact records is a measurement, and two are worth keeping:

- **`plugin/hooks/lexer.sh`'s `LEX_MAX_INPUT_BYTES=3072`.** Past the bound a line is not lexed at all and comes out as the unread marker. The bound is measured, not guessed: this lexer's worst shapes — a line of short words, a heredoc a shell reads, three nested substitutions — run 126–140 ms at 3 KiB, 151–214 ms at 4 KiB and over 400 ms at 8 KiB, while what a session really sends (`npm test`, a release line) runs in 14–25 ms. A hook runs before every call, which is what makes the tail worth cutting.
- **`bootstrap/lib/install-backup.sh`'s 300 MiB retention budget.** The measured problem was 1.9 GiB across 17 snapshots, and a single Codex snapshot already runs to about 110 MiB. Bounding "the last N" would have left size free to grow with whatever a future release's transaction happens to back up; bounding size keeps roughly two to three recent Codex snapshots.

Everything else the sweep removed is recoverable from `4584039`, the commit this slice was cut from, and this file does not pretend to be a transcript of 3,852 lines. What it claims is narrower and true: the measurements above are the ones a maintainer cannot re-derive from the code, and they are here.

## Consequences

- The rule that closes the class reads whole files with the heredoc- and quote-tracking awk that `check_no_verification_script_invokes_opencode_directly` already used, hoisted into one constant both rules share, so this repo has one reader of a heredoc body rather than two that can drift. Its ceilings: the locator is the physical line, so a hash-leading line inside a MULTI-LINE quoted string reads as a comment — which errs toward flagging, never toward missing one, and which is why the embedded awk and python comments went too — while a heredoc body is data, so a comment inside one is out of reach on purpose. It reads the shell sets `ci.yml` runs `bash -n` over and nothing wider.
- `bootstrap/install.bat`, `bootstrap/install.ps1`, `bootstrap/verify.bat` and `bootstrap/lib/toml-regions.awk` keep their comments — 183 lines the same class covers and this sweep did not touch. They are deliberately out: no bar this machine can run reads them, and a purge nothing can prove behaviour-neutral is the opposite of what this slice established. They are the named remainder, not a silent one.
- A shell file added from here on either declares an interpreter and carries no comment, or declares none and carries one block. There is no third shape and no exemption list to grow, which is the property ADR-0140 said a bar needs.
- The boundary took its first new file inside this same change and held. `bootstrap/lib/codex-install-backups.sh` declares no interpreter and carries one header block of 8 lines, so the tree stands at SEVEN shebang-less files rather than the six measured in Part 1, and `bootstrap/lib/install-backup.sh`'s own header grew by 3 lines in the same slice — 64 header lines in all where the sweep counted 53. The six and their 53 are what the sweep touched and stay written as measured; the seventh is the rule working rather than an exemption, and its arrival is why a count of files is never the bar here — the shape is.
