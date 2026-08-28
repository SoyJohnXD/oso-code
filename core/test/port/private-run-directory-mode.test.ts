import assert from "node:assert/strict";
import { statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { withStateSandbox, type StateSandbox } from "../support/state-sandbox.ts";

const STATE_ROOT = ".local/state/oso-code";
const RUN_STATE_FILE = ".local/state/oso-code/{repo}.state";
const RUNS_DIR = ".local/state/oso-code/runs";
const REPOSITORY_RUNS_DIR = ".local/state/oso-code/runs/{repo}";
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
      [STATE_ROOT]: { kind: "directory" },
      [RUN_STATE_FILE]: stateText({ ...RUN_STATE, auto_wait: autoWait }),
    });
    withHookEnvironment({ HOME: sandbox.home }, () => runGate(["autocontinue"], sandbox.expandJson(STOP_PAYLOAD)));
    return { runs: modeOf(sandbox, RUNS_DIR), repository: modeOf(sandbox, REPOSITORY_RUNS_DIR) };
  });
}

function skipUnlessMkdirHonoursOwnerOnlyMode(): false | string {
  if (process.platform !== "win32") return false;
  return (
    "win32 synthesises its own mode bits from FILE_ATTRIBUTE_READONLY and ignores mkdirSync's mode, so a " +
    "directory created 0o700 here reads back 0o666/0o777 (C2-D9, docs/rewrite/ts-core-roadmap.md:231)"
  );
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
