import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";
import { sha256Hex } from "../../src/state/store.ts";

const cliSource = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "bin", "oso.ts");
const sandbox = mkdtempSync(path.join(tmpdir(), "oso-profile-"));
const stateDirectory = path.join(sandbox, "state");
const project = realpathSync(mkdtempSync(path.join(sandbox, "project-")));
const mirror = path.join(stateDirectory, "profiles", `${sha256Hex(project)}.profile`);

const STRONG_MIRROR = `model_profile=strong
applier.tier=strong
verifier.tier=strong
judges.tier=strong
codex=pinned by host contract
unattended.doom_loop=ask
`;

function runProfile(...profileArguments: readonly string[]) {
  return spawnSync(process.execPath, ["--experimental-strip-types", cliSource, "profile", ...profileArguments], {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, HOME: sandbox, USERPROFILE: sandbox, OSO_STATE_DIR: stateDirectory },
  });
}

describe("oso profile mirrors the record beside the deny patterns and holds the verifier at or above the applier", () => {
  after(() => rmSync(sandbox, { recursive: true, force: true }));

  test("set strong writes every role at the strong tier, the codex pin and the doom-loop posture, keyed by the repository digest", () => {
    assert.equal(runProfile("set", "strong").status, 0);
    assert.equal(readFileSync(mirror, "utf8"), STRONG_MIRROR);
  });

  test("a second set strong rewrites the same bytes rather than appending to them", () => {
    assert.equal(runProfile("set", "strong").status, 0);
    assert.equal(readFileSync(mirror, "utf8"), STRONG_MIRROR);
  });

  test("show reads that mirror back and names the path it read it from", () => {
    const shown = runProfile("show");
    assert.equal(shown.status, 0);
    assert.ok(shown.stdout.includes(mirror) && shown.stdout.includes(STRONG_MIRROR), shown.stdout);
  });

  test("a custom whose verifier sits below its applier is refused by role, naming the tier that would have passed", () => {
    const refused = runProfile("set", "custom", "--applier", "strong", "--verifier", "default", "--judges", "strong");
    assert.equal(refused.status, 1);
    assert.equal(refused.stderr, "oso: profile set refused: the verifier tier default is below the applier tier strong — --verifier strong would have passed\n");
  });

  test("an unknown profile name is refused, naming the three names that would have passed", () => {
    const refused = runProfile("set", "fast");
    assert.equal(refused.status, 1);
    assert.equal(refused.stderr, "oso: profile set refused: fast is not a profile name — the names are normal, strong, custom\n");
  });
});
