import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  EXPECTED_CHILD_VERDICT,
  waveChildPositiveHolds,
  waveChildVerdictOf,
  waveIsolationBreached,
  waveIsolationIncomplete,
  waveSmokeOutcome,
  worktreePermissionAutoRejected,
  type WaveChildFacts,
  type WaveIsolationFacts,
} from "./wave-isolation.ts";

function withSyntheticStream(lines: readonly string[], use: (stream: string) => void): void {
  const directory = mkdtempSync(path.join(tmpdir(), "oso-wave-isolation-synthetic-"));
  const file = path.join(directory, "session.json");
  writeFileSync(file, `${lines.join("\n")}\n`);
  try {
    use(file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function textEvent(text: string): string {
  return JSON.stringify({ type: "text", part: { text } });
}

function child(overrides: Readonly<Partial<WaveChildFacts>> = {}): WaveChildFacts {
  return { verdict: EXPECTED_CHILD_VERDICT, ownProofMatches: true, crossProofPresent: false, mainProofPresent: false, ...overrides };
}

describe("waveChildVerdictOf, read over a synthetic --format json session stream this repository does not ship", () => {
  test("reads a correlated status: done / verdict: pass pair out of a single assistant text part", () => {
    withSyntheticStream([textEvent("status: done\nverdict: pass")], (stream) => assert.equal(waveChildVerdictOf(stream), EXPECTED_CHILD_VERDICT));
  });

  test("reports none for an empty stream and for a stream of malformed records alike, the shapes a child that never spoke would leave behind", () => {
    withSyntheticStream([], (stream) => assert.equal(waveChildVerdictOf(stream), "none"));
    withSyntheticStream(["{not json", '{"type":"tool"}'], (stream) => assert.equal(waveChildVerdictOf(stream), "none"));
  });

  test("reports an unreadable reading, folded onto one line, when the stream file itself does not exist", () => {
    const reading = waveChildVerdictOf(path.join(tmpdir(), "oso-wave-isolation-synthetic-absent", "absent.json"));
    assert.ok(reading.startsWith("unreadable:"), reading);
    assert.equal(reading.includes("\n"), false);
  });
});

describe("waveChildPositiveHolds", () => {
  test("holds only when the verdict matches and the child's own proof file matched too", () => {
    assert.equal(waveChildPositiveHolds(child()), true);
    assert.equal(waveChildPositiveHolds(child({ verdict: "status:done" })), false);
    assert.equal(waveChildPositiveHolds(child({ ownProofMatches: false })), false);
  });
});

describe("waveIsolationBreached and waveIsolationIncomplete, folding run_wave_children's independent facts", () => {
  test("finds no breach and nothing incomplete for two children that each produced their own proof and nothing else's", () => {
    const facts: WaveIsolationFacts = { wt1: child(), wt2: child() };
    assert.deepEqual(waveIsolationBreached(facts), []);
    assert.deepEqual(waveIsolationIncomplete(facts), []);
  });

  test("names every worktree a proof leaked into, independently of whether the children's own proofs matched", () => {
    const facts: WaveIsolationFacts = {
      wt1: child({ crossProofPresent: true, mainProofPresent: true }),
      wt2: child({ crossProofPresent: true }),
    };
    assert.deepEqual(waveIsolationBreached(facts), ["wt1-has-wt2-proof", "wt2-has-wt1-proof", "root-has-wt1-proof"]);
  });

  test("names a missing verdict and a missing proof as two separate incomplete markers, one child at a time", () => {
    const facts: WaveIsolationFacts = { wt1: child({ verdict: "" }), wt2: child({ ownProofMatches: false }) };
    assert.deepEqual(waveIsolationIncomplete(facts), ["wt1-verdict(none)", "wt2-proof"]);
  });
});

describe("worktreePermissionAutoRejected", () => {
  test("matches the host's own auto-rejection line wherever it appears among the children's raw output, and only there", () => {
    assert.equal(worktreePermissionAutoRejected(["nothing here", "permission requested: external_directory foo, auto-rejecting"]), true);
    assert.equal(worktreePermissionAutoRejected(["status: done", "verdict: pass"]), false);
  });
});

describe("waveSmokeOutcome, dispatching run_wave_smoke's four mutually exclusive branches", () => {
  test("resolves isolated for a correlated success — both positives hold, no breach", () => {
    const facts: WaveIsolationFacts = { wt1: child(), wt2: child() };
    assert.equal(waveSmokeOutcome(facts, ["", ""]), "isolated");
  });

  test("resolves breached even when a positive also failed, because a breach always outranks incompleteness", () => {
    const facts: WaveIsolationFacts = { wt1: child({ verdict: "" }), wt2: child({ crossProofPresent: true }) };
    assert.equal(waveSmokeOutcome(facts, ["", ""]), "breached");
  });

  test("resolves incomplete for a missing piece — a child that never produced its own proof — with no breach and no host refusal", () => {
    const facts: WaveIsolationFacts = { wt1: child(), wt2: child({ ownProofMatches: false }) };
    assert.equal(waveSmokeOutcome(facts, ["", ""]), "incomplete");
  });

  test("resolves host-refused-the-worktree when the same incompleteness carries the host's own auto-rejection line", () => {
    const facts: WaveIsolationFacts = { wt1: child(), wt2: child({ verdict: "" }) };
    const outputs = ["", "permission requested: external_directory foo, auto-rejecting"];
    assert.equal(waveSmokeOutcome(facts, outputs), "host-refused-the-worktree");
  });
});
