import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { GLOBAL_MARKER_END, GLOBAL_MARKER_START } from "../../src/install/opencode.ts";
import { HARNESS_EXTERNAL_DIRECTORIES, type ConfigDocument } from "../../src/install/opencode-config.ts";
import { OPENCODE_BINARY_NAME, openCodeHostProbes } from "../../src/install/opencode-host.ts";
import { SUPPORTED_OPENCODE_VERSION } from "../../src/install/pins.ts";
import { readProfileRoles, setProfile } from "../../src/install/profile.ts";
import { firstExecutableOnPath } from "../../src/install/verify-claude.ts";
import {
  installedAgentModelLine,
  openCodeConfigStatus,
  openCodeGlobalStatus,
  openCodeOperatorGlobalStatus,
  openCodeOperatorKeysStatus,
  openCodeVersionStatus,
  profiledAgentModelLine,
  OPENCODE_LOCAL_CHECK_ROWS,
  OPENCODE_NOT_ON_PATH,
  operatorConfigSeed,
  operatorGlobalSeed,
  OPERATOR_CONFIG_PROBE,
  type LocalCheckRowKind,
} from "../../src/install/verify-opencode.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import {
  fixtureEnvironment,
  fixturePathWith,
  pathWithoutOpenCode,
  stageInstalledFixture,
  writeOpenCodeShims,
  type StagedFixture,
} from "../support/opencode-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { skipUnlessChmodMakesFilesUnreadable, skipUnlessPathResolvesExtensionlessNames } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-opencode-verify-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const GLOBAL_SOURCE = path.join(repositoryRoot, "bootstrap", "opencode-global.md");

const THIS_HALF_READS: readonly LocalCheckRowKind[] = ["host", "config"];

const COMPARED_ROWS = [
  { name: "OpenCode CLI version" },
  { name: "OpenCode config contract" },
  { name: "operator config keys survive an install" },
  { name: "agent model keys from the profile" },
  { name: "global guidance installed" },
  { name: "operator global prose survives an install" },
] as const;

type FixtureDamage = Readonly<{ label: string; config?: (document: ConfigDocument) => void; global?: (content: string) => string }>;

const CONFIG_CONTRACT_DAMAGES: readonly FixtureDamage[] = [
  { label: "the plan-approval verdict rewritten", config: (document) => void (containerIn(document, "permission")["oso_plan_approve"] = "allow") },
  { label: "the plan-cancel verdict rewritten", config: (document) => void (containerIn(document, "permission")["oso_plan_cancel"] = "allow") },
  { label: "an owned skill mode allowed rather than denied", config: (document) => void (containerIn(document, "permission", "skill")["oso-plan"] = "allow") },
  { label: "plugin rewritten as a string", config: (document) => void (document["plugin"] = "nope") },
  { label: "mcp rewritten as a list of servers", config: (document) => void (document["mcp"] = [{ type: "local" }]) },
  {
    label: "a server declaring env where the contract spells environment",
    config: (document) => void (containerIn(document, "mcp")["oso-verify-damaged"] = { type: "local", command: ["operator-cli"], env: {} }),
  },
  ...HARNESS_EXTERNAL_DIRECTORIES.map((directory) => ({
    label: `the harness external directory ${directory} put back to a prompt`,
    config: (document: ConfigDocument) => void (containerIn(document, "permission", "external_directory")[directory] = "ask"),
  })),
  {
    label: "the harness external directories dropped whole",
    config: (document: ConfigDocument) => void delete containerIn(document, "permission")["external_directory"],
  },
];

const OPERATOR_KEY_DAMAGES: readonly FixtureDamage[] = [
  { label: "the operator theme dropped", config: (document) => void delete document["theme"] },
  { label: "the operator permission key dropped", config: (document) => void delete containerIn(document, "permission")[OPERATOR_CONFIG_PROBE.permissionKey] },
  { label: "the operator MCP server dropped", config: (document) => void delete containerIn(document, "mcp")[OPERATOR_CONFIG_PROBE.mcpServerName] },
  {
    label: "the operator MCP command rewritten",
    config: (document) => void (containerIn(document, "mcp", OPERATOR_CONFIG_PROBE.mcpServerName)["command"] = ["rewritten"]),
  },
];

const GLOBAL_DAMAGES: readonly Readonly<{ damage: FixtureDamage; verdict: string }>[] = [
  {
    verdict: "divergent",
    damage: {
      label: "a line the shipped body does not carry",
      global: (content) => content.replace(GLOBAL_MARKER_START, `${GLOBAL_MARKER_START}\na line the shipped body does not carry`),
    },
  },
  {
    verdict: "malformed",
    damage: {
      label: "a second start marker and no second end",
      global: (content) => content.replace(GLOBAL_MARKER_START, `${GLOBAL_MARKER_START}\n${GLOBAL_MARKER_START}`),
    },
  },
  {
    verdict: "malformed",
    damage: { label: "its end marker removed, leaving the region open", global: (content) => content.replaceAll(`${GLOBAL_MARKER_END}\n`, "") },
  },
  { verdict: "malformed", damage: { label: "its two markers swapped, so the region closes before it opens", global: withMarkersSwapped } },
];

function withMarkersSwapped(content: string): string {
  const swapped: Record<string, string> = { [GLOBAL_MARKER_START]: GLOBAL_MARKER_END, [GLOBAL_MARKER_END]: GLOBAL_MARKER_START };
  return content
    .split("\n")
    .map((record) => swapped[record] ?? record)
    .join("\n");
}

const UNREADABLE_CONFIG_MODE = 0o000;

const FALSY_MCP_DECLARATIONS: readonly Readonly<{ named: string; value: unknown }>[] = [
  { named: "an empty array", value: [] },
  { named: "null", value: null },
  { named: "an empty string", value: "" },
  { named: "zero", value: 0 },
];

const OPERATOR_PROSE_DAMAGE: FixtureDamage = {
  label: "the operator prose above the region rewritten",
  global: (content) => content.replace("# Personal OpenCode rules", "# Something else entirely"),
};

const PLANTED_AGENT_MODEL = "oso-verify/a-model-no-profile-named";

const PLANTED_AGENT_MODEL_DAMAGE: FixtureDamage = {
  label: "an agent model key no profile named",
  config: (document) => void (document["agent"] = { "oso-applier": { model: PLANTED_AGENT_MODEL } }),
};

const THE_VERIFY_CORPUS =
  "one fixture HOME staged by oso install --host opencode over a seeded operator config and AGENTS.md, then damaged one " +
  "way at a time and read row by row through core/src/install/verify-opencode.ts's own status functions, each verdict " +
  "spelled in the damage table beside the damage that must produce it";

const FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH = skipUnlessPathResolvesExtensionlessNames();

provedSomething(
  `the verify corpus is ${THE_VERIFY_CORPUS}, over ${COMPARED_ROWS.length} of the ` +
    `${OPENCODE_LOCAL_CHECK_ROWS.length} rows the local-check table declares`,
  COMPARED_ROWS.length === OPENCODE_LOCAL_CHECK_ROWS.filter((row) => THIS_HALF_READS.includes(row.kind)).length,
  "the compared rows are not the host and config rows this half owns, so the loop below proves less than it names",
);

describe("the local-check rows this half owns are named, and every other row is named as deferred", () => {
  test("the rows this half compares are exactly the host and config rows, and every other row is named as deferred", () => {
    const compared = OPENCODE_LOCAL_CHECK_ROWS.filter((row) => THIS_HALF_READS.includes(row.kind)).map((row) => row.name);
    const deferred = OPENCODE_LOCAL_CHECK_ROWS.filter((row) => !THIS_HALF_READS.includes(row.kind)).map((row) => row.name);
    assert.deepEqual(compared, COMPARED_ROWS.map((row) => row.name));
    assert.deepEqual(deferred, [
      "isolated fixture install",
      "nine skill wrappers and the shared skill directory installed",
      "agent contracts installed",
      "MCP surface closed on every installed agent",
      "mode commands installed and routed",
      "plugin entry, modules and routes installed",
      "Engram plugin file installed",
      "installer-owned targets recorded",
      "published gate bytes as installed",
      "an install outside the named home is refused",
      "OpenCode plugin typecheck",
      "OpenCode plugin test suite",
      "repository shell syntax",
    ]);
  });
});

describe("the loop with the opencode shim on PATH, where every row reaches its subject", () => {
  test("the version row reads the pin through the shim rather than through an installed host binary", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    assert.equal(openCodeVersionStatus(probesOn(shimmedPath())), SUPPORTED_OPENCODE_VERSION);
  });
});

describe("with the shim absent, where the not-on-path result is the one the version row must reach", () => {
  test("the version row reads opencode-not-on-path", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    assert.equal(openCodeVersionStatus(probesOn(bareMachinePath())), OPENCODE_NOT_ON_PATH);
  });
});

describe("the PATH both loops are built on, read by resolution alone so the G4 floor stands on every leg rather than on the one that spawns", () => {
  test("the bare path reaches no opencode at all, through the resolution openCodeHostProbes itself performs", () => {
    assert.equal(firstExecutableOnPath(resolutionEnvironment(bareMachinePath()), OPENCODE_BINARY_NAME), undefined);
    assert.equal(openCodeHostProbes(resolutionEnvironment(bareMachinePath())).version, undefined);
  });

  test("a directory holding an opencode is what the filter removes, so the emptiness above is the filter's doing and not this machine's", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const withShim = fixturePathWith(pathShapeShims());
    assert.equal(pathWithoutOpenCode({ PATH: withShim }), bareMachinePath());
    assert.equal(firstExecutableOnPath(resolutionEnvironment(withShim), OPENCODE_BINARY_NAME), path.join(pathShapeShims(), OPENCODE_BINARY_NAME));
  });
});

describe("every verdict each row can reach is shown on a deliberately broken subject, so no guard inside a row is unread", () => {
  for (const damage of CONFIG_CONTRACT_DAMAGES) {
    test(`a config with ${damage.label} is reported malformed`, { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
      const damaged = damagedFixture(damage);
      assert.equal(openCodeConfigStatus(damaged.configFile), "malformed");
      assert.notEqual(openCodeConfigStatus(damaged.configFile), openCodeConfigStatus(fixture().configFile));
    });
  }

  for (const damage of OPERATOR_KEY_DAMAGES) {
    test(`a config with ${damage.label} is reported dropped`, { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
      const damaged = damagedFixture(damage);
      assert.equal(openCodeOperatorKeysStatus(damaged.configFile), "dropped");
      assert.notEqual(openCodeOperatorKeysStatus(damaged.configFile), openCodeOperatorKeysStatus(fixture().configFile));
    });
  }

  for (const { damage, verdict } of GLOBAL_DAMAGES) {
    test(`a global file with ${damage.label} is reported ${verdict}`, { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
      const damaged = damagedFixture(damage);
      assert.equal(openCodeGlobalStatus(damaged.globalFile, globalBody()), verdict);
    });
  }

  test("a global file whose operator prose was rewritten above the region is reported rewritten", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const damaged = damagedFixture(OPERATOR_PROSE_DAMAGE);
    assert.equal(openCodeOperatorGlobalStatus(damaged.globalFile, operatorGlobalSeed()), "rewritten");
  });

  test("a config carrying an agent model key no profile named is read apart from the line the profile spells", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const damaged = damagedFixture(PLANTED_AGENT_MODEL_DAMAGE);
    assert.equal(installedAgentModelLine(damaged.configFile), `oso-applier=${PLANTED_AGENT_MODEL}`);
    underStateRoot(rootNoProfileNames(), () => {
      assert.notEqual(installedAgentModelLine(damaged.configFile), profiledAgentModelLine(damaged.configFile, repositoryRoot));
    });
  });
});

describe("the agent model row reads the installed keys against a profile mirror, under a state root this fixture owns rather than whichever one the machine running it carries", () => {
  test("a fixture staged where no profile names a role carries no agent model key, and the row reads both sides the same", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    underStateRoot(rootNoProfileNames(), () => {
      assert.deepEqual(readProfileRoles(repositoryRoot), {});
      assert.equal(installedAgentModelLine(fixture().configFile), profiledAgentModelLine(fixture().configFile, repositoryRoot));
    });
  });

  test("a mirror naming this repository in a root of its own is read back and parts the profiled side from the installed one, so the reading above is an absent mirror and not an unread call", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    underStateRoot(rootWhereAProfileNamesThisRepository(), () => {
      assert.deepEqual(Object.keys(readProfileRoles(repositoryRoot)).sort(), ["applier", "judges", "verifier"]);
      assert.notEqual(installedAgentModelLine(fixture().configFile), profiledAgentModelLine(fixture().configFile, repositoryRoot));
    });
  });
});

describe(
  "the two divergences C3-S4 measured and did not fix, each pinned as MEASURED and never as ratified (C2-D16) — the name says the behaviour " +
    "awaits the operator's ruling, so a refactor that moves it goes red and the decision that resolves it renames the case; the oracle half " +
    "of each measurement went with the bash and only the port's side is readable now",
  () => {
    test(
      "UNRULED, AWAITING THE OPERATOR — C3-S4 residual (7)(a): a falsy non-object mcp read valid by the oracle this child " +
        "retired and malformed by the port, and this pins the port's side of that measurement, which is the only side left to read",
      { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH },
      () => {
        for (const declaration of FALSY_MCP_DECLARATIONS) {
          const damaged = damagedFixture({ label: `mcp declared ${declaration.named}`, config: (document) => void (document["mcp"] = declaration.value) });
          assert.equal(openCodeConfigStatus(damaged.configFile), "malformed");
        }
      },
    );

    test(
      "UNRULED, AWAITING THE OPERATOR — C3-S4 residual (7)(b): an unreadable config read malformed and dropped by the oracle " +
        "this child retired and missing by the port on both rows, and this pins the port's side, which is the only side left to read",
      { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH || skipUnlessChmodMakesFilesUnreadable() },
      () => {
        const damaged = damagedFixture({ label: "a config no mode lets this user read" });
        const restoredMode = statSync(damaged.configFile).mode;
        chmodSync(damaged.configFile, UNREADABLE_CONFIG_MODE);
        try {
          assert.equal(openCodeConfigStatus(damaged.configFile), "missing");
          assert.equal(openCodeOperatorKeysStatus(damaged.configFile), "missing");
        } finally {
          chmodSync(damaged.configFile, restoredMode);
        }
      },
    );
  },
);



let staged: StagedFixture | undefined;

function fixture(): StagedFixture {
  if (staged !== undefined) return staged;
  staged = stageInstalledFixture(sandbox, {
    config: `${JSON.stringify(operatorConfigSeed(), null, 2)}\n`,
    global: operatorGlobalSeed(),
  });
  writeFileSync(path.join(sandbox, "operator-global.seed"), operatorGlobalSeed());
  return staged;
}

const damagedFixtures = new Map<string, StagedFixture>();

function damagedFixture(damage: FixtureDamage): StagedFixture {
  const built = damagedFixtures.get(damage.label);
  if (built !== undefined) return built;
  const subject = fixture();
  const configHome = path.join(sandbox, "damaged", damage.label.replaceAll(/[^a-z0-9]+/gi, "-"));
  mkdirSync(configHome, { recursive: true });
  const fresh = { ...subject, configHome, configFile: path.join(configHome, "opencode.json"), globalFile: path.join(configHome, "AGENTS.md") };
  const document = JSON.parse(readFileSync(subject.configFile, "utf8")) as ConfigDocument;
  damage.config?.(document);
  writeFileSync(fresh.configFile, `${JSON.stringify(document, null, 2)}\n`);
  const globalContent = readFileSync(subject.globalFile, "utf8");
  writeFileSync(fresh.globalFile, damage.global === undefined ? globalContent : damage.global(globalContent));
  damagedFixtures.set(damage.label, fresh);
  return fresh;
}

function underStateRoot<T>(stateRoot: string, read: () => T): T {
  return withHookEnvironment({ OSO_STATE_DIR: stateRoot }, read);
}

function rootNoProfileNames(): string {
  return path.join(sandbox, "state-no-profile-names");
}

function rootWhereAProfileNamesThisRepository(): string {
  const stateRoot = path.join(sandbox, "state-a-profile-names-this-repository");
  underStateRoot(stateRoot, () => setProfile(repositoryRoot, "strong", []));
  return stateRoot;
}

function containerIn(document: ConfigDocument, ...names: readonly string[]): ConfigDocument {
  let cursor = document;
  for (const name of names) cursor = cursor[name] as ConfigDocument;
  return cursor;
}

function shimmedPath(): string {
  return fixturePathWith(fixture().shims);
}

function bareMachinePath(): string {
  return pathWithoutOpenCode();
}

function pathShapeShims(): string {
  return writeOpenCodeShims(path.join(sandbox, "path-shape"), path.join(sandbox, "path-shape-calls.log"));
}

function resolutionEnvironment(pathValue: string): NodeJS.ProcessEnv {
  return fixtureEnvironment(sandbox, pathValue, sandbox);
}

function probesOn(pathValue: string) {
  return openCodeHostProbes({ ...fixtureEnvironment(fixture().home, pathValue, sandbox) });
}

function globalBody(): string {
  return readFileSync(GLOBAL_SOURCE, "utf8");
}
