import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { pathInsensitiveIncludes, pathSeparatorsEqual } from "./parity-expectations.ts";

const WINDOWS_TEMP_HOME = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\oso-state-p4Eo20\\home";
const DIGEST = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

function windowsSessionStartStdout(additionalContext: string): string {
  return `${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } })}\n`;
}

test(
  "a POSIX-separated runs/<digest>/run.log fragment is still found inside a Windows gate's own " +
    "JSON-escaped additionalContext, where JSON.stringify doubles every path separator " +
    "(the outbound direction nativizeRootedPaths never covers, reanchor gate fixtures 356/360/363)",
  () => {
    const runLog = path.win32.join(WINDOWS_TEMP_HOME, ".local", "state", "oso-code", "runs", DIGEST, "run.log");
    const stdout = windowsSessionStartStdout(`NEXT: read ${runLog}`);
    assert.ok(
      pathInsensitiveIncludes(stdout, `runs/${DIGEST}/run.log`),
      `expected ${JSON.stringify(stdout)} to carry runs/${DIGEST}/run.log once its doubled JSON backslashes are unified`,
    );
  },
);

test(
  "the plugin/bin/oso-state absolute path plugin-root-fallback.test.ts pins is still found inside " +
    "a Windows stale gate's own JSON-escaped remedy, compared through the same helper the reanchor " +
    "fixtures use instead of a raw single-backslash regex",
  () => {
    const pluginRoot = path.win32.join(WINDOWS_TEMP_HOME, "..", "..", "repo", "plugin");
    const stateBin = path.win32.join(pluginRoot, "bin", "oso-state");
    const stdout = windowsSessionStartStdout(`run "${stateBin}" --session s clear`);
    assert.ok(
      pathInsensitiveIncludes(stdout, stateBin),
      `expected ${JSON.stringify(stdout)} to carry ${stateBin} once its doubled JSON backslashes are unified`,
    );
  },
);

test(
  "a raw, non-JSON mixed-separator expectation still equals a Windows state file's all-backslash " +
    "content (the statebin fixture's {repoRoot}/plugin/bin/oso-state literal, correct as-is because " +
    "state_after content is never JSON-escaped)",
  () => {
    const repoRoot = "C:\\Users\\RUNNER~1\\repo";
    const expected = `export OSO_STATE_BIN=${repoRoot}/plugin/bin/oso-state`;
    const actual = `export OSO_STATE_BIN=${path.win32.join(repoRoot, "plugin", "bin", "oso-state")}\n`;
    assert.ok(pathSeparatorsEqual(expected, actual.replace(/\n+$/, "")));
  },
);
