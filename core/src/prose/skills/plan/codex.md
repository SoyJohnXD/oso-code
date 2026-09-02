# Plan mode

Host precondition: this operator-only skill starts only when Codex's active
collaboration mode is `Plan`. If it is not, stop immediately and tell the
operator to enter `/plan` (or use Shift+Tab), then invoke `$oso-code:plan` again.
Never imitate the transition by printing `/plan`, and do not begin phase 0 in
Default mode. The installed `UserPromptSubmit` hook enforces the same boundary;
this instruction is the fallback before that hook has been trusted.

This mode's instructions live in two files. READ BOTH NOW, in this order, and follow them as binding — as if their text stood here. Both paths resolve against the directory holding this file:

1. `../_shared/bodies/plan.md` — the flow itself: the phase contracts, the reconciliation gates, the ledger discipline, the verdict vocabularies. It is the same on every host this harness runs on.
2. `references/codex.md` — what the flow leaves to the host: the tools it calls, the paths it resolves, the approval gate, the state command, and the installed runtime gates.

Where the neutral body defers to "your host", the platform file is the answer, and it is the only answer.
