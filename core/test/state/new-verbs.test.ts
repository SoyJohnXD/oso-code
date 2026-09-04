import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { mismatchesRunning } from "../support/fixture-runner.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { loadFixturesFrom, type RunnableFixture } from "../support/parity-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot, STATE_FILE, withStateSandbox, type StateSubject } from "../support/state-sandbox.ts";

const FIXTURE_DIRECTORY = path.join(repositoryRoot, "core", "test", "fixtures", "state-new-verbs");

const CLI_SOURCE = path.join(repositoryRoot, "core", "src", "bin", "oso-state.ts");

const CLI_SUBJECT: StateSubject = {
  name: "core/src/bin/oso-state.ts",
  command: [process.execPath, "--experimental-strip-types", CLI_SOURCE],
};

const ARMED_STATE = "auto=running\nauto_change=rewrite-prose\nsession=test-session\n";

function loadFixtures(): RunnableFixture[] {
  return loadFixturesFrom(FIXTURE_DIRECTORY, (file) => JSON.parse(readFileSync(file, "utf8")) as RunnableFixture);
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
        assert.deepEqual(mismatchesRunning(CLI_SUBJECT, fixture), []);
      });
    }
  },
);

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
