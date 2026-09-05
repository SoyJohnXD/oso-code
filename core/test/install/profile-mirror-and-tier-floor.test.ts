import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";
import { mergeOpenCodeConfig, OPENCODE_AGENTS_THE_PROFILE_DRIVES, remainingPromptsOf } from "../../src/install/opencode-config.ts";
import { profileRolesOf, readProfile } from "../../src/install/profile.ts";
import { isModelToken, isNameToken, MODEL_TOKEN_SHAPE, sha256Hex } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";

const cliSource = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "bin", "oso.ts");
const sandbox = mkdtempSync(path.join(tmpdir(), "oso-profile-"));
const stateDirectory = path.join(sandbox, "state");
const project = realpathSync(mkdtempSync(path.join(sandbox, "project-")));
const mirror = path.join(stateDirectory, "profiles", `${sha256Hex(project)}.profile`);
const repositoryNoMirrorNames = realpathSync(mkdtempSync(path.join(sandbox, "repository-no-mirror-names-")));

const STILL_STOPS_A_RUN = "every prompt this host asks today still stops an unattended run";

const SESSION_STRONG_MODEL = "oso-profile-fixture/a-strong-session-model";
const SESSION_DEFAULT_MODEL = "oso-profile-fixture/a-default-session-model";

const AN_INSTALL_FROM_THIS_DIRECTORY = "run oso install --host opencode from this directory";
const SET_A_PROFILE_FOR_THIS_REPOSITORY =
  "no profile for this repository — set one with `oso profile set normal|strong|custom …` from this directory";

const CONFIG_HOME_BEYOND_SKILL = "external_directory ~/.config/opencode/** beyond skill/";
const HARNESS_STATE_ROOT = "external_directory ~/.local/state/oso-code/**";
const READS_THE_GRANTS_LEAVE_ASKING = [CONFIG_HOME_BEYOND_SKILL, HARNESS_STATE_ROOT];

const VERIFIER_BELOW_APPLIER = "the verifier tier default is below the applier tier strong";
const JUDGES_BELOW_STRONG = "the judges tier default is below the strong tier the forked judges hold";

const HAND_EDITED_MIRRORS = [
  {
    label: "a verifier hand-edited below its applier",
    content: "model_profile=custom\napplier.tier=strong\nverifier.tier=default\njudges.tier=strong\n",
    reason: `${VERIFIER_BELOW_APPLIER} — verifier.tier=strong would have passed`,
  },
  {
    label: "the forked judges hand-edited below the strong tier",
    content: "model_profile=custom\napplier.tier=default\nverifier.tier=default\njudges.tier=default\n",
    reason: `${JUDGES_BELOW_STRONG} — judges.tier=strong would have passed`,
  },
] as const;

const OPERATOR_MODEL = "ollama/kimi-k2.6:cloud";
const CUSTOM_STRONG_JUDGES = "model_profile=custom\napplier.tier=default\nverifier.tier=default\njudges.tier=strong\n";
const JUDGES_OVERRIDE_LINE = `judges: strong declared — model ${OPERATOR_MODEL} overrides the tier's session field; the harness cannot rank it`;

const REFUSED_MIRRORS = [
  {
    label: "a judges tier no tier vocabulary spells",
    content: "model_profile=custom\napplier.tier=default\nverifier.tier=default\njudges.tier=formidable\n",
    reason: "judges.tier=formidable names no tier — the tiers are default, strong",
  },
  {
    label: "a mirror naming no verifier tier at all",
    content: "model_profile=custom\napplier.tier=default\njudges.tier=strong\n",
    reason: "verifier.tier names no record — exactly one verifier.tier= record would have passed",
  },
  {
    label: "a second judges tier record beside the first",
    content: `${CUSTOM_STRONG_JUDGES}judges.tier=default\n`,
    reason: "judges.tier names 2 records — exactly one judges.tier= record would have passed",
  },
  {
    label: "a judges model whose planted newline injects a second tier record",
    content: `${CUSTOM_STRONG_JUDGES}judges.model=${OPERATOR_MODEL}\njudges.tier=default\n`,
    reason: "judges.tier names 2 records — exactly one judges.tier= record would have passed",
  },
  {
    label: "a second judges model record beside the first",
    content: `${CUSTOM_STRONG_JUDGES}judges.model=${OPERATOR_MODEL}\njudges.model=another/model\n`,
    reason: "judges.model names 2 records — exactly one judges.model= record would have passed",
  },
  {
    label: "a judges model carrying a space",
    content: `${CUSTOM_STRONG_JUDGES}judges.model=a model\n`,
    reason: `judges.model="a model" names no model — ${MODEL_TOKEN_SHAPE} would have passed`,
  },
  {
    label: "a judges model carrying an equals sign",
    content: `${CUSTOM_STRONG_JUDGES}judges.model=vendor=model\n`,
    reason: `judges.model="vendor=model" names no model — ${MODEL_TOKEN_SHAPE} would have passed`,
  },
] as const;

const STRONG_MIRROR = `model_profile=strong
applier.tier=strong
verifier.tier=strong
judges.tier=strong
codex=pinned by host contract
unattended.doom_loop=ask
`;

function runProfileFrom(workingDirectory: string, home: string, ...profileArguments: readonly string[]) {
  return spawnSync(process.execPath, ["--experimental-strip-types", cliSource, "profile", ...profileArguments], {
    cwd: workingDirectory,
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

function runProfileIn(home: string, ...profileArguments: readonly string[]) {
  return runProfileFrom(project, home, ...profileArguments);
}

function runProfile(...profileArguments: readonly string[]) {
  return runProfileIn(sandbox, ...profileArguments);
}

function gitRepositoryAt(name: string): string {
  const repository = realpathSync(mkdtempSync(path.join(sandbox, `${name}-`)));
  execFileSync("git", ["-C", repository, "init", "-q"]);
  return repository;
}

function commonDirectoryOf(repository: string): string {
  return execFileSync("git", ["-C", repository, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
}

function mirrorOf(repository: string): string {
  return path.join(stateDirectory, "profiles", `${sha256Hex(commonDirectoryOf(repository))}.profile`);
}

function keyedToLineOf(repository: string): string {
  return `this profile is per repository, keyed to ${commonDirectoryOf(repository)} (digest ${sha256Hex(commonDirectoryOf(repository))})`;
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

function configCarryingInstalledAgentModels(): string {
  const seed = {
    model: SESSION_STRONG_MODEL,
    small_model: SESSION_DEFAULT_MODEL,
    agent: { "oso-applier": { model: SESSION_STRONG_MODEL }, "oso-verifier": { model: SESSION_DEFAULT_MODEL } },
  };
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
    assert.equal(refused.stderr, `oso: profile set refused: ${VERIFIER_BELOW_APPLIER} — --verifier strong would have passed\n`);
  });

  test("a custom putting the forked judges below the strong tier is refused, naming the tier that would have passed", () => {
    const refused = runProfile("set", "custom", "--applier", "default", "--verifier", "default", "--judges", "default");
    assert.equal(refused.status, 1);
    assert.equal(refused.stderr, `oso: profile set refused: ${JUDGES_BELOW_STRONG} — --judges strong would have passed\n`);
  });

  test("an unknown profile name is refused, naming the three names that would have passed", () => {
    const refused = runProfile("set", "fast");
    assert.equal(refused.status, 1);
    assert.equal(refused.stderr, "oso: profile set refused: fast is not a profile name — the names are normal, strong, custom\n");
  });
});

describe("remainingPromptsOf reads the prompts a rendered config still asks, so a posture is a list rather than a hope", () => {
  test("a config spelling no doom_loop still lists it, because ask is the verdict the host reaches without one", () => {
    assert.deepEqual(remainingPromptsOf({ permission: {} }), ["doom_loop", ...READS_THE_GRANTS_LEAVE_ASKING]);
    assert.deepEqual(remainingPromptsOf({}), ["doom_loop", ...READS_THE_GRANTS_LEAVE_ASKING]);
    assert.deepEqual(remainingPromptsOf("not a config at all"), ["doom_loop", ...READS_THE_GRANTS_LEAVE_ASKING]);
  });

  test("a doom_loop the operator set to allow drops off the list, and one set to ask appears exactly once", () => {
    assert.deepEqual(remainingPromptsOf({ permission: { doom_loop: "allow" } }), READS_THE_GRANTS_LEAVE_ASKING);
    assert.deepEqual(remainingPromptsOf({ permission: { doom_loop: "ask" } }), ["doom_loop", ...READS_THE_GRANTS_LEAVE_ASKING]);
  });

  test("a patterned rule lists one line per asking pattern and none for the patterns it allows or denies", () => {
    const gated = { permission: { doom_loop: "allow", bash: { "*": "allow", "git commit *": "ask", "rm *": "deny", "git push*": "ask" } } };
    assert.deepEqual(remainingPromptsOf(gated), ["bash git commit *", "bash git push*", ...READS_THE_GRANTS_LEAVE_ASKING]);
  });

  test("the grant-bound tools remain prompts where the harness external directories do not, on the config the installer renders", () => {
    assert.deepEqual(remainingPromptsOf(mergeOpenCodeConfig({}, "fallow-mcp").document), [
      "doom_loop",
      ...READS_THE_GRANTS_LEAVE_ASKING,
      "oso_plan_approve",
      "oso_plan_cancel",
    ]);
  });

  test("the two reads C0-D5(a) stopped granting are listed as the degrade they are, and an operator's own allow over either one takes it off the list", () => {
    const allowedByTheOperator = (pattern: string) => ({ permission: { doom_loop: "allow", external_directory: { [pattern]: "allow" } } });
    assert.deepEqual(remainingPromptsOf(allowedByTheOperator("~/.config/opencode/**")), [HARNESS_STATE_ROOT]);
    assert.deepEqual(remainingPromptsOf(allowedByTheOperator("~/.local/state/oso-code/**")), [CONFIG_HOME_BEYOND_SKILL]);
    assert.deepEqual(remainingPromptsOf(allowedByTheOperator("~/.config/opencode/skill/**")), READS_THE_GRANTS_LEAVE_ASKING);
    assert.deepEqual(remainingPromptsOf({ permission: { doom_loop: "allow", external_directory: { "~/.config/opencode/**": "ask" } } }), [
      "external_directory ~/.config/opencode/**",
      ...READS_THE_GRANTS_LEAVE_ASKING,
    ]);
  });
});

describe("oso profile show prints those prompts from the rendered config beside the profile it read", () => {
  test("an installed config's own ask rules, the grant-bound tools and the unspelled doom_loop are listed in one sorted block", () => {
    const home = homeCarrying("home-with-a-gated-commit", renderedConfigWhereTheOperatorGatesCommits());
    const shown = runProfileIn(home, "show");
    assert.equal(shown.status, 0);
    assert.ok(
      shown.stdout.endsWith(
        promptSection(home, "bash git commit *", "doom_loop", ...READS_THE_GRANTS_LEAVE_ASKING, "oso_plan_approve", "oso_plan_cancel"),
      ),
      shown.stdout,
    );
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

describe("oso profile show marks every agent model key the installed config carries against the mirror it read, per repository", () => {
  test("a key equal to what this mirror names reads as matching, one that is not reads as set elsewhere, and a missing one names the install that would write it", () => {
    writeFileSync(mirror, STRONG_MIRROR);
    const home = homeCarrying("home-with-installed-agent-models", configCarryingInstalledAgentModels());
    const shown = runProfileIn(home, "show");
    assert.equal(shown.status, 0);
    assert.ok(shown.stdout.includes(`  oso-applier=${SESSION_STRONG_MODEL} — matches this mirror\n`), shown.stdout);
    assert.ok(
      shown.stdout.includes(
        `  oso-verifier=${SESSION_DEFAULT_MODEL} — differs — set from another repository or by hand; ${AN_INSTALL_FROM_THIS_DIRECTORY} to apply this mirror\n`,
      ),
      shown.stdout,
    );
    assert.ok(shown.stdout.includes(`  oso-triage — absent — ${AN_INSTALL_FROM_THIS_DIRECTORY} to apply\n`), shown.stdout);
  });

  test("a repository no mirror names reads each key as installed information and closes on the profile set that would give those keys a mirror to mean something against, naming no install that would write nothing", () => {
    const home = homeCarrying("home-read-from-a-repository-no-mirror-names", configCarryingInstalledAgentModels());
    const shown = runProfileFrom(repositoryNoMirrorNames, home, "show");
    const marked = shown.stdout.split("\n").filter((line) => line.startsWith("  oso-"));
    assert.equal(shown.status, 0);
    assert.ok(shown.stdout.includes("\nno profile at "), shown.stdout);
    assert.equal(marked.length, OPENCODE_AGENTS_THE_PROFILE_DRIVES.length);
    assert.deepEqual(marked.filter((line) => line.includes(AN_INSTALL_FROM_THIS_DIRECTORY)), [], shown.stdout);
    assert.ok(marked.includes(`  oso-applier — installed: ${SESSION_STRONG_MODEL}`), shown.stdout);
    assert.ok(marked.includes(`  oso-verifier — installed: ${SESSION_DEFAULT_MODEL}`), shown.stdout);
    assert.ok(marked.includes("  oso-triage — installed: none"), shown.stdout);
    assert.ok(shown.stdout.includes(`  ${SET_A_PROFILE_FOR_THIS_REPOSITORY}\n`), shown.stdout);
  });

  test("the block names the config it read and marks every agent the profile drives, so a key dropped from the block is a shorter list this counts", () => {
    writeFileSync(mirror, STRONG_MIRROR);
    const home = homeCarrying("home-with-a-full-agent-block", configCarryingInstalledAgentModels());
    const configFile = path.join(home, ".config", "opencode", "opencode.json");
    const shown = runProfileIn(home, "show");
    assert.ok(shown.stdout.includes(`agent model keys the installed OpenCode config carries, read from ${configFile}:\n`), shown.stdout);
    assert.equal(shown.stdout.split("\n").filter((line) => line.startsWith("  oso-")).length, OPENCODE_AGENTS_THE_PROFILE_DRIVES.length);
  });

  test("a config no JSON parser can read names that failure once instead of marking six keys absent over input it never read", () => {
    writeFileSync(mirror, STRONG_MIRROR);
    const home = homeCarrying("home-with-a-broken-config-under-the-agent-block", "{ not json");
    const configFile = path.join(home, ".config", "opencode", "opencode.json");
    const shown = runProfileIn(home, "show");
    assert.ok(shown.stdout.includes(`  cannot parse JSON at ${configFile}, so no agent model key was read\n`), shown.stdout);
    assert.equal(shown.stdout.split("\n").filter((line) => line.startsWith("  oso-")).length, 0);
  });
});

describe("the tier floor is read off the mirror as well as written to it, so a hand-edited mirror never reaches an install unchecked", () => {
  for (const { label, content, reason } of HAND_EDITED_MIRRORS) {
    test(`${label} is refused when the mirror is read, naming the mirror and the record that would have passed`, () => {
      writeFileSync(mirror, content);
      assert.throws(
        () => withHookEnvironment({ OSO_STATE_DIR: stateDirectory }, () => readProfile(project)),
        { message: `the profile mirror at ${mirror} is refused: ${reason}` },
      );
    });
  }

  test("the mirror oso profile set writes is read back whole, so the refusals above are the floor and not an unreadable mirror", () => {
    writeFileSync(mirror, STRONG_MIRROR);
    const roles = withHookEnvironment({ OSO_STATE_DIR: stateDirectory }, () => profileRolesOf(readProfile(project)));
    assert.deepEqual(Object.keys(roles).sort(), ["applier", "judges", "verifier"]);
  });
});

describe("the mirror is read record by record, so a role record missing, duplicated or unparseable refuses rather than dropping the role", () => {
  for (const { label, content, reason } of REFUSED_MIRRORS) {
    test(`${label} is refused when the mirror is read, naming the record that would have passed`, () => {
      writeFileSync(mirror, content);
      assert.throws(
        () => withHookEnvironment({ OSO_STATE_DIR: stateDirectory }, () => readProfile(project)),
        { message: `the profile mirror at ${mirror} is refused: ${reason}` },
      );
    });
  }
});

describe("a model override is a token of its own — wider than a name token, and never a line the mirror can be extended with", () => {
  test("the provider-shaped models an operator actually runs pass the model rule, where the name rule rejects the same string", () => {
    assert.equal(isModelToken(OPERATOR_MODEL), true);
    assert.equal(isNameToken(OPERATOR_MODEL), false);
  });

  test("a set naming a provider-shaped model writes exactly one model record and reads it back whole", () => {
    const set = runProfile("set", "custom", "--applier", "default", "--verifier", "default", "--judges", `strong:${OPERATOR_MODEL}`);
    assert.equal(set.status, 0);
    assert.equal(
      readFileSync(mirror, "utf8"),
      `${CUSTOM_STRONG_JUDGES}judges.model=${OPERATOR_MODEL}\ncodex=pinned by host contract\nunattended.doom_loop=ask\n`,
    );
    const roles = withHookEnvironment({ OSO_STATE_DIR: stateDirectory }, () => profileRolesOf(readProfile(project)));
    assert.equal(roles.judges?.model, OPERATOR_MODEL);
  });

  test("a set whose model carries a newline is refused before any record is written, with the newline shown rather than passed through", () => {
    const injected = `${OPERATOR_MODEL}\njudges.tier=default`;
    const before = readFileSync(mirror, "utf8");
    const refused = runProfile("set", "custom", "--applier", "default", "--verifier", "default", "--judges", `strong:${injected}`);
    assert.equal(refused.status, 1);
    assert.equal(
      refused.stderr,
      `oso: profile set refused: --judges strong:${JSON.stringify(injected)} names no model — ${MODEL_TOKEN_SHAPE} would have passed\n`,
    );
    assert.equal(readFileSync(mirror, "utf8"), before);
  });
});

describe("a model override is printed as the limit it is: the floor ranks tiers, and no provider string carries an order to rank", () => {
  test("show names the role, the tier the mirror declared and the model that overrides the tier's session field", () => {
    writeFileSync(mirror, `${CUSTOM_STRONG_JUDGES}judges.model=${OPERATOR_MODEL}\n`);
    const home = homeCarrying("home-reading-a-model-override", renderedConfigWhereTheOperatorGatesCommits());
    const shown = runProfileIn(home, "show");
    assert.equal(shown.status, 0);
    assert.ok(shown.stdout.includes(`\n${JUDGES_OVERRIDE_LINE}\n`), shown.stdout);
  });

  test("a mirror naming no model at all prints no such line, so the line is the override and never the profile", () => {
    writeFileSync(mirror, STRONG_MIRROR);
    const home = homeCarrying("home-reading-no-model-override", renderedConfigWhereTheOperatorGatesCommits());
    const shown = runProfileIn(home, "show");
    assert.equal(shown.stdout.includes("the harness cannot rank it"), false, shown.stdout);
  });
});

describe("the profile is per repository: its subject is the repository of the directory the verb runs in, never the tree the CLI was installed from", () => {
  test("two repositories each keep a mirror of their own, so a set run from one leaves the other with none", () => {
    const first = gitRepositoryAt("first-project");
    const second = gitRepositoryAt("second-project");
    assert.equal(runProfileFrom(first, sandbox, "set", "strong").status, 0);

    assert.notEqual(mirrorOf(first), mirrorOf(second));
    assert.equal(readFileSync(mirrorOf(first), "utf8"), STRONG_MIRROR);
    assert.equal(existsSync(mirrorOf(second)), false);
  });

  test("show run from each of those repositories reads that repository's own mirror and names the digest it is keyed to", () => {
    const first = gitRepositoryAt("shown-first");
    const second = gitRepositoryAt("shown-second");
    assert.equal(runProfileFrom(first, sandbox, "set", "strong").status, 0);

    const shownInFirst = runProfileFrom(first, sandbox, "show").stdout;
    const shownInSecond = runProfileFrom(second, sandbox, "show").stdout;
    assert.ok(shownInFirst.includes(`${mirrorOf(first)}\n${STRONG_MIRROR}`), shownInFirst);
    assert.ok(shownInFirst.includes(keyedToLineOf(first)), shownInFirst);
    assert.ok(shownInSecond.includes(`no profile at ${mirrorOf(second)}`), shownInSecond);
    assert.ok(shownInSecond.includes(keyedToLineOf(second)), shownInSecond);
  });

  test("set ends its own report with that same keyed-to line, so the repository a mirror was written for is never left to inference", () => {
    const repository = gitRepositoryAt("set-reports");
    const report = runProfileFrom(repository, sandbox, "set", "normal").stdout;
    assert.ok(report.endsWith(`${keyedToLineOf(repository)}\n`), report);
  });
});
