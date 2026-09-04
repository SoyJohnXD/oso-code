import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { BEHAVIOR_BAR_LOAD_BOUND_SECONDS } from "./behavior-drive.ts";
import { countHostPluginLoadErrors, type HostPluginLoadReading } from "./plugin-entry.ts";

const ONE_MILLISECOND_IN_SECONDS = 0.001;

function unreadReasonOf(reading: HostPluginLoadReading): string {
  if (reading.kind !== "unread") assert.fail(`a host run that never completed read as ${JSON.stringify(reading)}`);
  return reading.reason;
}

describe("countHostPluginLoadErrors, driven against a host run that never happened", () => {
  test("a binary path nothing can spawn reads unread and names ENOENT, never the count of zero a row would trust", () => {
    const reading = countHostPluginLoadErrors(path.join(tmpdir(), "oso-no-such-opencode-binary"), process.env, BEHAVIOR_BAR_LOAD_BOUND_SECONDS);
    assert.match(unreadReasonOf(reading), /ENOENT/);
  });

  test("a one-millisecond bound reads unread and names the timeout beside the bound it broke, never a count of zero", () => {
    const reading = countHostPluginLoadErrors(process.execPath, process.env, ONE_MILLISECOND_IN_SECONDS);
    assert.match(unreadReasonOf(reading), /ETIMEDOUT.*0\.001s bound/);
  });
});
