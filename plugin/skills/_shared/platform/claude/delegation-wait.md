# Delegation wait — Claude Code

## Making a launch wait

This host offers no foreground flag on a launch — the flag this section claimed until now is retired, because the `Agent` tool's schema never carried it. That tool always launches in the BACKGROUND and returns at once, with the agent id and nothing about the work.

The delegation's report therefore arrives in a LATER turn, as a completion notification that re-enters the conversation. That notification IS the resume. The turn that launched ends there, and ending it is correct rather than a stall.

**Nothing may act on a report it has not read.** A step taken before the notification arrives is a step taken on a verdict nobody has, which is the whole reason the neutral body requires the read at all. So never predict, assume or report a delegation's result before its notification, and never relaunch a delegation that is in flight — the notification is what resumes it, and a second launch over the same tree is two writers in one slice.

**The marker.** Before any launch whose result arrives in a later turn, arm `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set auto_wait=<label>` — the label being the slice number or `wave-<n>`, matching `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$` — and return it to `auto_wait=none` the same way once every report for that label has been read. Under an unattended run this is what stops the `Stop` net counting a delegation's turn-end as a stall; the net believes a mark for 45 minutes and then stops believing it, so a mark left armed EXPIRES rather than disarming the net for good. A milestone journaled while the mark stands restarts that window, at most 3 times, so a delegation the run keeps moving under is believed longer and a delegation nothing has moved under is not. The whole bound is scoped to ONE label under ONE session — a new label, a return to `auto_wait=none`, and any rewrite of the mark each start it over — so it bounds a single delegation's hold and guarantees nothing about a run as a whole. Arm it on EVERY delegation and not only under `auto=running`: one unconditional rule survives a compaction where a conditional the orchestrator must re-derive does not, and nothing reads the key without the marker, so an attended run pays only the write.

This governs every launch made through the Agent tool, named by that property rather than by a list the next tool change would falsify. The mode binding beside this file that sent you here names the launches its own flow makes.
