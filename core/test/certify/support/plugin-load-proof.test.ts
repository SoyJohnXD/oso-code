import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { failedLoadLinesOf, pluginLoadProofOf } from "./plugin-load-proof.ts";

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
