import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { meetsVersionFloor, SUPPORTED_OPENCODE_VERSION } from "../../src/install/pins.ts";
import { skipUnlessKernelRunsScriptFixtures } from "../support/win32-skip-guards.ts";
import { laneCauseFor, resolveOpenCodeBinaryProbe } from "../certify/support/opencode-binary.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-opencode-binary-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

function binaryPrinting(name: string, versionOutput: string): string {
  const binary = path.join(sandbox, name);
  writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' '${versionOutput}'\n`);
  chmodSync(binary, 0o700);
  return binary;
}

describe("the pin is the OpenCode 2 version the certify suites were measured on", () => {
  test("pins 2.2.6, so a 1.x host sits below the floor", () => {
    assert.equal(SUPPORTED_OPENCODE_VERSION, "2.2.6");
    assert.equal(meetsVersionFloor("1.18.22", SUPPORTED_OPENCODE_VERSION), false);
    assert.equal(meetsVersionFloor("2.2.6", SUPPORTED_OPENCODE_VERSION), true);
  });
});

describe("resolveOpenCodeBinaryProbe reads the version line the host prints", { skip: skipUnlessKernelRunsScriptFixtures() }, () => {
  test("`opencode v2.2.6`, the OpenCode 2 form, resolves at the pin", () => {
    const probe = resolveOpenCodeBinaryProbe(binaryPrinting("v2", "opencode v2.2.6"), SUPPORTED_OPENCODE_VERSION, process.env);
    assert.deepEqual(probe, { kind: "resolved", binary: path.join(sandbox, "v2"), version: "2.2.6", relation: "at-pin" });
  });

  test("a newer OpenCode 2 line resolves above the pin", () => {
    const probe = resolveOpenCodeBinaryProbe(binaryPrinting("v2-newer", "opencode v2.9.0"), SUPPORTED_OPENCODE_VERSION, process.env);
    assert.equal(probe.kind === "resolved" && probe.relation, "above-pin");
  });

  test("a bare dotted OpenCode 1 version is read as 1.18.22 and refused by the floor, never misread", () => {
    const probe = resolveOpenCodeBinaryProbe(binaryPrinting("v1", "1.18.22"), SUPPORTED_OPENCODE_VERSION, process.env);
    assert.equal(probe.kind === "resolved" && probe.version, "1.18.22");
    assert.equal(probe.kind === "resolved" && probe.relation, "below-floor");
    assert.match(laneCauseFor(probe, SUPPORTED_OPENCODE_VERSION) ?? "", /opencode 1\.18\.22 .* is below the 2\.2\.6 floor/);
  });
});
