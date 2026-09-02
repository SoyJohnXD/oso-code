# Security pass — Claude Code

## Which reviewer is native, and how to reach it

The native reviewer is Anthropic's `security-review` skill, and you take the native path only when it appears in THIS fork's skill listing. Invoke it through the Skill tool: because you are the fork, its review prompt injects into your context and never into the orchestrator's.

If `security-review` is NOT listed here, run the hybrid fallback instead. Absent from the listing is the only trigger — never a preference, never a guess about what it would find.

The exact native header on this host remains `Security Pass: native`. The native reviewer selects its own acquisition surface; neither gather nor pass it a diff.
