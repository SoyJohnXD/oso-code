# Plan mode

Host precondition: this operator-only skill starts only when the operator
invokes `/oso-plan`. The installed `opencode.json` denies it to the model
(`permission.skill: {"oso-plan": "deny"}`), so the model never sees it and a
model call to the `skill` tool for it is rejected; never imitate the invocation
by printing the command. This instruction is the fallback before that config
has been written by the installer.

This mode's instructions live in two files. READ BOTH NOW, in this order, and follow them as binding — as if their text stood here. Both paths resolve against the directory holding this file:

1. `../_shared/bodies/plan.md` — the flow itself: the phase contracts, the reconciliation gates, the ledger discipline, the verdict vocabularies. It is the same on every host this harness runs on.
2. `../_shared/platform/opencode/plan.md` — what the flow leaves to the host: the tools it calls, the paths it resolves, the approval gate, the amendment lane behind it, the state command, the wait rule every launch runs under, and the installed runtime gates.

Where the neutral body defers to "your host", the platform file is the answer, and it is the only answer — never improvise a spelling the platform file does not give.
