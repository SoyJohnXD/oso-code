# Quick mode

Host precondition: this operator-only skill starts only when the operator
invokes `/oso-quick`. The installed `opencode.json` denies it to the model
(`permission.skill: {"oso-quick": "deny"}`), so the model never sees it and a
model call to the `skill` tool for it is rejected; never imitate the invocation
by printing the command. This instruction is the fallback before that config
has been written by the installer.

The flow that follows this preface is the same on every host this harness runs on. It opens by pointing you at `references/opencode.md` — what it leaves to this host: the delivery contract it speaks under, the question rounds it asks in, the tools it calls, the paths it resolves, the state command, and the installed runtime gates.
