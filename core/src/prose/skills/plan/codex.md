# Plan mode

Host precondition: this operator-only skill starts only when Codex's active
collaboration mode is `Plan`. If it is not, stop immediately and tell the
operator to enter `/plan` (or use Shift+Tab), then invoke `$oso-code:plan` again.
Never imitate the transition by printing `/plan`, and do not begin phase 0 in
Default mode. The installed `UserPromptSubmit` hook enforces the same boundary;
this instruction is the fallback before that hook has been trusted.

The flow that follows this preface is the same on every host this harness runs on. It opens by pointing you at `references/codex.md` — what it leaves to this host: the tools it calls, the paths it resolves, the approval gate, the state command, and the installed runtime gates.
