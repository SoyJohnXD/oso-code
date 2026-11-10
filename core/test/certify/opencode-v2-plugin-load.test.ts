import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test, type TestContext } from "node:test";
import { SUPPORTED_OPENCODE_VERSION } from "../../src/install/pins.ts";
import { CERTIFY, CERTIFY_GUARD } from "./support/certify-guard.ts";
import { CONTRACT_BAR_BOUND_SECONDS } from "./support/drive.ts";
import {
  createSpikeFixture,
  disposeSpikeFixture,
  driveScenario,
  v2LaneCause,
  type ScenarioOutcome,
  type SpikeFixture,
} from "./support/host-spike.ts";
import {
  laneNotRun,
  resolveOpenCodeBinaryProbe,
  resolvedProbeOrThrow,
  type OpenCodeBinaryProbe,
  type ResolvedProbe,
} from "./support/opencode-binary.ts";
import { pluginLoadProofOf } from "../../src/install/opencode-load-proof.ts";
import { runLoadProbe } from "./support/plugin-load-proof.ts";

const OVERRIDE_ENV_VAR = "OSO_V2_HOST_SPIKE_OPENCODE_BIN";
const BUNDLE_FILE = "oso-code.js";
const BUNDLE_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "opencode", "dist", BUNDLE_FILE);
const PUBLISHED_VARIABLES = ["OSO_STATE_BIN", "OSO_AGENT"] as const;

const probe: OpenCodeBinaryProbe | undefined = CERTIFY
  ? resolveOpenCodeBinaryProbe(process.env[OVERRIDE_ENV_VAR], SUPPORTED_OPENCODE_VERSION, process.env)
  : undefined;

const laneCause = v2LaneCause(probe);

describe("the built OpenCode adapter bundle installed into an isolated OpenCode 2 host", () => {
  let fixture: SpikeFixture | undefined;
  let resolved: ResolvedProbe | undefined;
  let shellOutcome: ScenarioOutcome | undefined;

  before(async () => {
    if (probe === undefined || laneCause !== undefined) return;
    resolved = resolvedProbeOrThrow(probe);
    fixture = await createSpikeFixture();
    fixture.writeExtraPlugin(BUNDLE_FILE, readFileSync(BUNDLE_SOURCE, "utf8"));
    for (const name of PUBLISHED_VARIABLES) delete fixture.environment[name];
    const command = PUBLISHED_VARIABLES.map((name) => `echo ${name}=$${name}`).join("; ");
    shellOutcome = await driveScenario(resolved, fixture, "bundle-shell", "shell", { command, description: "probe" });
  });

  after(async () => {
    if (fixture !== undefined) await disposeSpikeFixture(fixture);
  });

  function lane(t: TestContext): boolean {
    return laneNotRun(t, probe, laneCause);
  }

  test("the bundle loads: positive loading evidence for oso-code.js and zero failed-to-load lines", CERTIFY_GUARD, (t) => {
    if (lane(t) || fixture === undefined || resolved === undefined) return;
    const run = runLoadProbe(resolved.binary, fixture.environment, fixture.project, CONTRACT_BAR_BOUND_SECONDS);
    assert.equal(run.status, 0, run.stderr);
    const proof = pluginLoadProofOf(run.stderr, BUNDLE_FILE);
    assert.equal(proof.loadedLines.length, 1, run.stderr);
    assert.deepEqual(proof.failedLines, []);
  });

  test("a shell command the host spawns carries the identity variables the bundle's create.before hook publishes", CERTIFY_GUARD, (t) => {
    if (lane(t) || shellOutcome === undefined) return;
    const [toolResult] = shellOutcome.toolResults;
    assert.ok(toolResult !== undefined, shellOutcome.run.stderr);
    for (const name of PUBLISHED_VARIABLES) {
      assert.match(toolResult, new RegExp(`^${name}=.+$`, "m"));
    }
  });
});
