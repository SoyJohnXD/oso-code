# Roadmap mode

Host precondition: this operator-only skill starts only when the operator
invokes `/oso-roadmap`. The installed `opencode.json` denies it to the model
(`permission.skill: {"oso-roadmap": "deny"}`), so the model never sees it and a
model call to the `skill` tool for it is rejected; never imitate the invocation
by printing the command. This instruction is the fallback before that config
has been written by the installer.

The flow that follows this preface is the same on every host this harness runs on. It opens by pointing you at `references/opencode.md`. What it leaves to this host: the agent every phase runs on, how far the chain runs unattended, the approval gate its one approval crosses, the paths it resolves, and the state command every runtime write of the chain runs under, which that file routes to plan's own reference file rather than spelling twice.
