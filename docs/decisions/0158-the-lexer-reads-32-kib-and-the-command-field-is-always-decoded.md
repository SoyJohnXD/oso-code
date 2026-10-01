# 0158 — The lexer reads 32 KiB, and the command field is always decoded

Date: 2026-10-01
Status: accepted
Supersedes: ADR-0053's input and decoder bounds alone — "Input and decoder bounds sit at 3072 bytes" and the coverage cost it states for a command field past them — and ADR-0154's ledger entry for `LEX_MAX_INPUT_BYTES=3072` as the bound the TypeScript gates read. Everything else both decisions recorded stands, and `plugin/hooks/lexer.sh` keeps its own 3072 untouched
Source: this change (proddeploy-false-positives), slice 2; the production boundary's own denial log over 30 days, and the TypeScript lexer measured on this machine before and after the slice

## Decision

**`MAX_LEXED_INPUT_BYTES` is 32768 decoded UTF-8 bytes, counting the sentinel newline the lexer appends, so a command line of 32767 bytes is read and one of 32768 is not. The hook envelope decodes the command field whatever its length, and the lexer's bound alone decides what is read.**

### Why the old bound went

The 3072 bytes were measured on the bash lexer: its worst shapes ran 126–140 ms at 3 KiB and over 400 ms at 8 KiB, and a hook runs before every call. The gates no longer run that lexer. They run `core/src/shell/lexer.ts`, and the cost the bound was cutting is gone with it.

What the bound cost instead was measured in the production boundary's denials. Of 211 `prod-deploy-denied` events in 30 days, 89 were lines past 3072 bytes, the longest 17,204 bytes. The common shape was a pull request body written through a heredoc and followed by the push of the run's own branch, which is exactly the finish the boundary exists to protect. Past the bound that line was unread, and an unread line is production there, so the run was stopped at its last step.

### Why 32 KiB

Measured on the TypeScript lexer before this slice, the worst shapes ADR-0053 and ADR-0154 name — a line of short words, a heredoc a shell reads, nested substitutions — ran about 3 ms at 3 KiB, 5 ms at 8 KiB, 11–16 ms at 32 KiB and at most 30 ms at 64 KiB. 32 KiB covers the longest line the log recorded nearly twice over and keeps the worst shape near 15 ms.

Two paths were not linear, and raising the bound exposed them. A brace checked every word before it on each `{` or `}`, so a run of prefix-shaped words followed by brace words (`coproc …`, `- …` or `X=1 …`, then `{a …`) took 1.5–3.1 s for two runs at 32 KiB. Prefix stripping copied the word list once per prefix word, so `timeout 1 1 1 …` and `sudo -n -n …` took 0.2–0.4 s. The lexer now counts the leading prefix words as it reads them and strips them with one cut.

After that change, two warm runs over each shape at 32 KiB take 5–15 ms on this machine: short words 5.7, the heredoc 12.0, nested substitutions 14.4, the three brace runs 5.1–6.6, the timeout run 7.4 and the sudo run 4.6. The same shapes take 1–4 ms at 8 KiB and under 2 ms at 3 KiB. `core/test/shell/lexer-latency.test.ts` holds two runs over each shape at the bound under one second, so a path that turns quadratic again fails by name.

### Why the decoder bound went with it

The envelope skipped JSON decoding for a command field past the bound and handed the escaped text on, which was only safe because the lexer would refuse that text anyway. With the bound in bytes of decoded text, a field whose escapes inflated it past 3072 characters could still decode to a line the lexer reads. Two bounds measuring two different things is how a line ends up unread by one rule and readable by the other, so the envelope keeps none.

## Consequences

- Shapes past 3072 bytes are read now, and the commit rail is stricter on them: a commit padded past 3 KiB, with or without `--no-verify` or escaped quotes, is denied while verify is red rather than spent as residue. Each fixture whose verdict flipped was renamed to state its new verdict.
- At the production boundary a deploy past 3 KiB is denied as the production deploy it spells, and a long pull request body followed by the run's own branch push is allowed.
- A line past 32767 bytes is still unread, still production at the boundary and still residue at the commit rail. The gate fixtures pin both sides of the edge, and the lexer tests pin a multibyte line whose characters number half the bound.
- `plugin/hooks/lexer.sh` and the legacy bash hooks keep 3072. No hook route runs them; every gate runs in node.
