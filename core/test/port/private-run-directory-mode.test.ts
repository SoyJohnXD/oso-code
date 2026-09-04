import assert from "node:assert/strict";
import { statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import {
  REPOSITORY_RUNS_DIR,
  RUNS_DIR,
  STATE_FILE,
  STATE_ROOT_THESE_TESTS_SPELL,
  withStateSandbox,
  type StateSandbox,
} from "../support/state-sandbox.ts";
import { skipUnlessMkdirHonoursOwnerOnlyMode } from "../support/win32-skip-guards.ts";

const OWNER_ONLY_DIRECTORY = 0o700;

const RUN_STATE: Readonly<Record<string, string>> = {
  mode: "plan",
  auto: "running",
  auto_change: "hanko",
  active_slice: "18",
  verify_green: "false",
  session: "test-session",
};

const STOP_PAYLOAD = '{"session_id":"test-session","cwd":"{cwd}","hook_event_name":"Stop","stop_hook_active":false}';

function stateText(fields: Readonly<Record<string, string>>): string {
  return `${Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

function modeOf(sandbox: StateSandbox, relativePath: string): number {
  return statSync(path.join(sandbox.home, sandbox.expand(relativePath))).mode & 0o777;
}

function pushedRunDirectoryModes(autoWait: string): { runs: number; repository: number } {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed({
      [STATE_ROOT_THESE_TESTS_SPELL]: { kind: "directory" },
      [STATE_FILE]: stateText({ ...RUN_STATE, auto_wait: autoWait }),
    });
    withHookEnvironment({ HOME: sandbox.home }, () => runGate(["autocontinue"], spawnedEnvelope(sandbox.expandJson(STOP_PAYLOAD), process.env)));
    return { runs: modeOf(sandbox, RUNS_DIR), repository: modeOf(sandbox, REPOSITORY_RUNS_DIR) };
  });
}

describe(
  "core/src/gates/autocontinue.ts and delegation.ts: the run's private state directory is created owner-only, " +
    "not left at mkdir's default 755, matching plugin/hooks/auto-continue.sh:101-107's 'umask 077; mkdir -p' " +
    "and the same primitive appendJournal already gets from core/src/state/store.ts:190-196,320",
  { skip: skipUnlessMkdirHonoursOwnerOnlyMode() },
  () => {
    test("a push tally that creates runs/<repo>/ (autocontinue.ts:196, rememberPush) leaves both new levels owner-only", () => {
      const modes = pushedRunDirectoryModes("none");
      assert.deepEqual(modes, { runs: OWNER_ONLY_DIRECTORY, repository: OWNER_ONLY_DIRECTORY });
    });

    test("a wait mark that creates runs/<repo>/ (delegation.ts:65, writeWaitMark) leaves both new levels owner-only", () => {
      const modes = pushedRunDirectoryModes("18");
      assert.deepEqual(modes, { runs: OWNER_ONLY_DIRECTORY, repository: OWNER_ONLY_DIRECTORY });
    });
  },
);
