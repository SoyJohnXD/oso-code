# Roadmap mode

Host precondition: this operator-only skill starts only when Codex's active
collaboration mode is `Plan`, because §1 plans the queue with the operator
through `request_user_input`, which this host exposes only there. If it is not,
stop immediately and tell the operator to enter `/plan` (or use Shift+Tab), then
invoke `$oso-code:roadmap` again. Never imitate the transition by printing
`/plan`, and do not begin §1 in Default mode. No installed hook gates this
invocation: `UserPromptSubmit` refuses `$oso-code:plan` outside Plan Mode and no
other skill invocation, so this instruction is the whole of that boundary.

The flow that follows this preface is the same on every host this harness runs on. It opens by pointing you at `references/codex.md` — what it leaves to this host: how far the chain runs unattended, the paths it resolves, where each child still waits for the operator, and the state command every runtime write of the chain runs under, which that file routes to plan's own reference file rather than spelling twice.
