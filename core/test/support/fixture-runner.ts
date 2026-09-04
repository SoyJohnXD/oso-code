import { expectationMismatches, type ObservedRun } from "./parity-expectations.ts";
import type { RunnableFixture } from "./parity-fixture.ts";
import { StateSandbox, withStateSandbox, type ObservedEntry, type StateSubject } from "./state-sandbox.ts";

export function mismatchesRunning(subject: StateSubject, fixture: RunnableFixture): string[] {
  return withStateSandbox(fixture.cwd, (sandbox) => {
    sandbox.seed(fixture.state_before);
    const eventsBefore = sandbox.eventLogLines().length;
    const run = sandbox.run(subject, fixture.argv, { stdin: fixture.stdin, env: fixture.env });
    const observed: ObservedRun = {
      ...run,
      entries: entriesTheExpectationNames(sandbox, fixture),
      eventsAppended: sandbox.eventLogLines().slice(eventsBefore),
    };
    return expectationMismatches(fixture.expect, observed, (text) => sandbox.expand(text));
  });
}

function entriesTheExpectationNames(sandbox: StateSandbox, fixture: RunnableFixture): Map<string, ObservedEntry> {
  const named = Object.keys(fixture.expect.state_after ?? {});
  return new Map(named.map((entryPath) => [entryPath, sandbox.read(entryPath)]));
}
