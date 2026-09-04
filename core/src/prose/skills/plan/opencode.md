# Plan mode

Host precondition: this operator-only skill starts only when the operator
invokes `/oso-plan`. The installed `opencode.json` denies it to the model
(`permission.skill: {"oso-plan": "deny"}`), so the model never sees it and a
model call to the `skill` tool for it is rejected; never imitate the invocation
by printing the command. This instruction is the fallback before that config
has been written by the installer.

The flow that follows this preface is the same on every host this harness runs on. It opens by pointing you at `references/opencode.md` — what it leaves to this host: the tools it calls, the paths it resolves, the approval gate, the amendment lane behind it, the state command, the wait rule every launch runs under, and the installed runtime gates.
