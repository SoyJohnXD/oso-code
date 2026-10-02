import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { appendMarker, appendVerdict, readVerdicts } from "../../src/verdict/record.ts";

const APPENDS = 100;
const MEAN_APPEND_BUDGET_MS = 5;

test(`a verdict append costs at most ${MEAN_APPEND_BUDGET_MS} ms on average over ${APPENDS} appends`, () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "oso-verdicts-perf-"));
  process.env["OSO_STATE_DIR"] = stateDirectory;
  try {
    const verdictsFile = path.join(stateDirectory, "runs", "repo", "verdicts.jsonl");
    appendMarker(verdictsFile, { kind: "arm", slice: "1", session: "ses-perf", change: null });
    const started = performance.now();
    for (let run = 0; run < APPENDS; run += 1) {
      const written = appendVerdict(verdictsFile, {
        host: "opencode",
        session: "ses-perf",
        change: null,
        slice: "1",
        role: "verifier",
        model: null,
        verdict: "fail",
        verdict_shape: "valid",
      });
      assert.equal(written, true);
    }
    const meanMs = (performance.now() - started) / APPENDS;
    assert.equal(readVerdicts(verdictsFile).entries.length, APPENDS + 1);
    assert.ok(meanMs <= MEAN_APPEND_BUDGET_MS, `mean append took ${meanMs.toFixed(3)} ms`);
  } finally {
    delete process.env["OSO_STATE_DIR"];
    rmSync(stateDirectory, { recursive: true, force: true });
  }
});
