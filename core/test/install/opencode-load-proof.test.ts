import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { openCodePluginLoadStatus } from "../../src/install/verify-opencode.ts";
import { failedLoadLinesOf, pluginLoadProofOf } from "../../src/install/opencode-load-proof.ts";
import { skipUnlessKernelRunsScriptFixtures } from "../support/win32-skip-guards.ts";

const LOADING_LINE = 'timestamp=t level=INFO run=r msg="loading plugin" id=/h/.config/opencode/plugin/oso-code.js entrypoint=file:///h/oso-code.js';
const FAILED_LINE = 'timestamp=t level=WARN run=r message="failed to load plugin" target=/h/.config/opencode/plugin/oso-code.js cause="x"';
const UNRELATED_LINE = 'timestamp=t level=INFO run=r message="watcher started" path=/h/oso-code.js';

describe("pluginLoadProofOf", () => {
  test("a loading line naming the plugin file with no failed line is the positive evidence of a load", () => {
    const proof = pluginLoadProofOf([UNRELATED_LINE, LOADING_LINE].join("\n"), "oso-code.js");
    assert.deepEqual(proof, { loadedLines: [LOADING_LINE], failedLines: [] });
  });

  test("a rejected plugin still logs its loading line, so the failed line is what breaks the proof", () => {
    const proof = pluginLoadProofOf([LOADING_LINE, FAILED_LINE].join("\n"), "oso-code.js");
    assert.equal(proof.loadedLines.length, 1);
    assert.deepEqual(proof.failedLines, [FAILED_LINE]);
  });

  test("a log with no loading line for the plugin proves nothing even when it holds no failure", () => {
    const proof = pluginLoadProofOf(UNRELATED_LINE, "oso-code.js");
    assert.deepEqual(proof, { loadedLines: [], failedLines: [] });
  });
});

describe("failedLoadLinesOf", () => {
  test("counts every failed-to-load line whichever plugin or plugin id it names", () => {
    const setupFailure = 'timestamp=t level=WARN run=r message="failed to load plugin" plugin.id=oso-code cause="x"';
    assert.deepEqual(failedLoadLinesOf([FAILED_LINE, LOADING_LINE, setupFailure].join("\n")), [FAILED_LINE, setupFailure]);
  });
});

describe("openCodePluginLoadStatus", { skip: skipUnlessKernelRunsScriptFixtures() }, () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), "oso-load-status-"));
  after(() => rmSync(sandbox, { recursive: true, force: true }));

  function hostLogging(name: string, stderr: string, exitCode = 0): string {
    const binary = path.join(sandbox, name);
    writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' '${stderr}' >&2\nexit ${exitCode}\n`);
    chmodSync(binary, 0o700);
    return binary;
  }

  test("a loading line for the bundle and no failed line is loaded", () => {
    assert.equal(openCodePluginLoadStatus(hostLogging("loaded", LOADING_LINE), process.env, sandbox), "loaded");
  });

  test("a failed line for any plugin is named even when the bundle itself loaded", () => {
    const status = openCodePluginLoadStatus(hostLogging("failed", `${LOADING_LINE}\n${FAILED_LINE}`), process.env, sandbox);
    assert.match(status, /^failed: .*failed to load plugin/);
  });

  test("a log with no loading line for the bundle is not a load", () => {
    assert.equal(openCodePluginLoadStatus(hostLogging("silent", UNRELATED_LINE), process.env, sandbox), "loading-lines:0");
  });

  test("a probe that exits non-zero names the exit", () => {
    assert.equal(openCodePluginLoadStatus(hostLogging("broken", UNRELATED_LINE, 3), process.env, sandbox), "probe-failed: exit 3");
  });
});
