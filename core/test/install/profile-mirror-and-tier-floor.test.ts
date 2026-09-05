import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";
import { mergeOpenCodeConfig, remainingPromptsOf } from "../../src/install/opencode-config.ts";
import { sha256Hex } from "../../src/state/store.ts";

const cliSource = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "bin", "oso.ts");
const sandbox = mkdtempSync(path.join(tmpdir(), "oso-profile-"));
const stateDirectory = path.join(sandbox, "state");
const project = realpathSync(mkdtempSync(path.join(sandbox, "project-")));
const mirror = path.join(stateDirectory, "profiles", `${sha256Hex(project)}.profile`);

const STILL_STOPS_A_RUN = "every prompt this host asks today still stops an unattended run";

const STRONG_MIRROR = `model_profile=strong
applier.tier=strong
verifier.tier=strong
judges.tier=strong
codex=pinned by host contract
unattended.doom_loop=ask
`;

function runProfileIn(home: string, ...profileArguments: readonly string[]) {
  return spawnSync(process.execPath, ["--experimental-strip-types", cliSource, "profile", ...profileArguments], {
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      OSO_STATE_DIR: stateDirectory,
    },
  });
}

function runProfile(...profileArguments: readonly string[]) {
  return runProfileIn(sandbox, ...profileArguments);
}

function homeCarrying(name: string, openCodeConfig: string | undefined): string {
  const home = path.join(sandbox, name);
  const configHome = path.join(home, ".config", "opencode");
  mkdirSync(configHome, { recursive: true });
  if (openCodeConfig !== undefined) writeFileSync(path.join(configHome, "opencode.json"), openCodeConfig);
  return home;
}

function renderedConfigWhereTheOperatorGatesCommits(): string {
  const seed = { permission: { bash: { "git commit *": "ask", "*": "allow" } } };
  return `${JSON.stringify(mergeOpenCodeConfig(seed, "fallow-mcp").document, null, 2)}\n`;
}

function promptSection(home: string, ...lines: readonly string[]): string {
  const configFile = path.join(home, ".config", "opencode", "opencode.json");
  return [`prompts that remain on OpenCode, read from ${configFile}:`, ...lines.map((line) => `  ${line}`), ""].join("\n");
}

after(() => rmSync(sandbox, { recursive: true, force: true }));

describe("oso profile mirrors the record beside the deny patterns and holds the verifier at or above the applier", () => {
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

describe("remainingPromptsOf reads the prompts a rendered config still asks, so a posture is a list rather than a hope", () => {
  test("a config spelling no doom_loop still lists it, because ask is the verdict the host reaches without one", () => {
    assert.deepEqual(remainingPromptsOf({ permission: {} }), ["doom_loop"]);
    assert.deepEqual(remainingPromptsOf({}), ["doom_loop"]);
    assert.deepEqual(remainingPromptsOf("not a config at all"), ["doom_loop"]);
  });

  test("a doom_loop the operator set to allow drops off the list, and one set to ask appears exactly once", () => {
    assert.deepEqual(remainingPromptsOf({ permission: { doom_loop: "allow" } }), []);
    assert.deepEqual(remainingPromptsOf({ permission: { doom_loop: "ask" } }), ["doom_loop"]);
  });

  test("a patterned rule lists one line per asking pattern and none for the patterns it allows or denies", () => {
    const gated = { permission: { doom_loop: "allow", bash: { "*": "allow", "git commit *": "ask", "rm *": "deny", "git push*": "ask" } } };
    assert.deepEqual(remainingPromptsOf(gated), ["bash git commit *", "bash git push*"]);
  });

  test("the grant-bound tools remain prompts where the harness external directories do not, on the config the installer renders", () => {
    assert.deepEqual(remainingPromptsOf(mergeOpenCodeConfig({}, "fallow-mcp").document), ["doom_loop", "oso_plan_approve", "oso_plan_cancel"]);
  });
});

describe("oso profile show prints those prompts from the rendered config beside the profile it read", () => {
  test("an installed config's own ask rules, the grant-bound tools and the unspelled doom_loop are listed in one sorted block", () => {
    const home = homeCarrying("home-with-a-gated-commit", renderedConfigWhereTheOperatorGatesCommits());
    const shown = runProfileIn(home, "show");
    assert.equal(shown.status, 0);
    assert.ok(shown.stdout.endsWith(promptSection(home, "bash git commit *", "doom_loop", "oso_plan_approve", "oso_plan_cancel")), shown.stdout);
  });

  test("a home with no OpenCode config says so and names what that leaves standing, rather than printing an empty posture", () => {
    const home = homeCarrying("home-with-no-config", undefined);
    const shown = runProfileIn(home, "show");
    assert.equal(shown.status, 0);
    assert.ok(shown.stdout.endsWith(promptSection(home, `no readable OpenCode config, so ${STILL_STOPS_A_RUN}`)), shown.stdout);
  });

  test("a config that is not readable JSON names the file it could not parse rather than reporting no prompts at all", () => {
    const home = homeCarrying("home-with-a-broken-config", "{ not json");
    const shown = runProfileIn(home, "show");
    const configFile = path.join(home, ".config", "opencode", "opencode.json");
    assert.equal(shown.status, 0);
    assert.ok(shown.stdout.endsWith(promptSection(home, `cannot parse JSON at ${configFile}, so ${STILL_STOPS_A_RUN}`)), shown.stdout);
  });
});
