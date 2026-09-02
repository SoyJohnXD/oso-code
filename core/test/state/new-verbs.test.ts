import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { expectationMismatches, type ObservedRun } from "../support/parity-expectations.ts";
import type { FixtureExpectation } from "../support/parity-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import {
  repositoryRoot,
  STATE_FILE,
  withStateSandbox,
  type ObservedEntry,
  type SeededEntry,
  type StateSandbox,
  type StateSubject,
} from "../support/state-sandbox.ts";

const FIXTURE_DIRECTORY = path.join(repositoryRoot, "core", "test", "fixtures", "state-new-verbs");

const CLI_SOURCE = path.join(repositoryRoot, "core", "src", "bin", "oso-state.ts");

const CLI_SUBJECT: StateSubject = {
  name: "core/src/bin/oso-state.ts",
  command: [process.execPath, "--experimental-strip-types", CLI_SOURCE],
};

const ARMED_STATE = "auto=running\nauto_change=rewrite-prose\nsession=test-session\n";

type NewVerbFixture = {
  name: string;
  env: Readonly<Record<string, string>>;
  state_before: Readonly<Record<string, SeededEntry>>;
  cwd: string;
  argv: readonly string[];
  stdin: string;
  expect: FixtureExpectation;
};

function loadFixtures(): NewVerbFixture[] {
  return readdirSync(FIXTURE_DIRECTORY)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => JSON.parse(readFileSync(path.join(FIXTURE_DIRECTORY, entry), "utf8")) as NewVerbFixture);
}

const fixtures = loadFixtures();

provedSomething(
  `at least one close-slice/deny-pattern fixture loaded from ${FIXTURE_DIRECTORY}`,
  fixtures.length > 0,
  `zero fixtures loaded from ${FIXTURE_DIRECTORY}`,
);

describe(
  `${fixtures.length} port fixtures for G6's two new verbs, run directly against the TypeScript CLI (they carry ` +
    "no bash source citation because the verbs never existed in the bash oso-state, so they are port tests, never parity)",
  () => {
    for (const fixture of fixtures) {
      test(fixture.name, () => {
        assert.deepEqual(mismatchesOf(fixture), []);
      });
    }
  },
);

function mismatchesOf(fixture: NewVerbFixture): string[] {
  return withStateSandbox(fixture.cwd, (sandbox) => {
    sandbox.seed(fixture.state_before);
    const eventsBefore = sandbox.eventLogLines().length;
    const run = sandbox.run(CLI_SUBJECT, fixture.argv, { stdin: fixture.stdin, env: fixture.env });
    const observed: ObservedRun = {
      ...run,
      entries: entriesTheExpectationNames(sandbox, fixture),
      eventsAppended: sandbox.eventLogLines().slice(eventsBefore),
    };
    return expectationMismatches(fixture.expect, observed, (text) => sandbox.expand(text));
  });
}

function entriesTheExpectationNames(sandbox: StateSandbox, fixture: NewVerbFixture): Map<string, ObservedEntry> {
  const named = Object.keys(fixture.expect.state_after ?? {});
  return new Map(named.map((entryPath) => [entryPath, sandbox.read(entryPath)]));
}

function payloadRunning(command: string): string {
  return JSON.stringify({
    session_id: "test-session",
    cwd: "{cwd}",
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  });
}

test(
  "a pattern added through deny-pattern add is the same file core/src/gates/proddeploy.ts reads, so the gate " +
    "denies a command that pattern matches (the consumer proof that the writer and the reader share one path)",
  () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: ARMED_STATE });
      const added = sandbox.run(CLI_SUBJECT, ["--session", "test-session", "deny-pattern", "add", "npm run build"]);
      assert.equal(added.exit, 0, added.stderr);

      const run = withHookEnvironment({ HOME: sandbox.home }, () =>
        runGate(["proddeploy"], spawnedEnvelope(sandbox.expandJson(payloadRunning("npm run build")), process.env)),
      );
      assert.match(run.stdout, /"permissionDecision":"deny"/);
      assert.deepEqual(
        run.events.map((event) => event.event),
        ["prod-deploy-denied"],
      );
    });
  },
);
