import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { GLOBAL_MARKER_END, GLOBAL_MARKER_START } from "../../src/install/opencode.ts";
import type { ConfigDocument } from "../../src/install/opencode-config.ts";
import { OPENCODE_BINARY_NAME, openCodeHostProbes } from "../../src/install/opencode-host.ts";
import { SUPPORTED_OPENCODE_VERSION } from "../../src/install/pins.ts";
import { firstExecutableOnPath } from "../../src/install/verify-claude.ts";
import {
  openCodeConfigStatus,
  openCodeGlobalStatus,
  openCodeOperatorGlobalStatus,
  openCodeOperatorKeysStatus,
  openCodeVersionStatus,
  OPENCODE_LOCAL_CHECK_ROWS,
  OPENCODE_NOT_ON_PATH,
  operatorConfigSeed,
  operatorGlobalSeed,
  OPERATOR_CONFIG_PROBE,
  type LocalCheckRowKind,
} from "../../src/install/verify-opencode.ts";
import {
  bashIsAvailable,
  bashVerifyRow,
  fixtureEnvironment,
  fixturePathWith,
  pathWithoutOpenCode,
  stageInstalledFixture,
  writeOpenCodeShims,
  type StagedFixture,
} from "../support/opencode-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { skipUnlessBashRunsTheInstallerPipeline, skipUnlessChmodMakesFilesUnreadable } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-opencode-verify-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const VERIFY_SCRIPT = path.join(repositoryRoot, "bootstrap", "verify-opencode.sh");
const GLOBAL_SOURCE = path.join(repositoryRoot, "bootstrap", "opencode-global.md");

const THIS_HALF_READS: readonly LocalCheckRowKind[] = ["host", "config"];

const COMPARED_ROWS = [
  { name: "OpenCode CLI version", bashRow: "opencode_version_status", port: () => openCodeVersionStatus(probesOn(shimmedPath())) },
  { name: "OpenCode config contract", bashRow: "opencode_config_status", port: () => openCodeConfigStatus(fixture().configFile) },
  { name: "operator config keys survive an install", bashRow: "opencode_operator_keys_status", port: () => openCodeOperatorKeysStatus(fixture().configFile) },
  { name: "global guidance installed", bashRow: "opencode_global_status", port: () => openCodeGlobalStatus(fixture().globalFile, globalBody()) },
  {
    name: "operator global prose survives an install",
    bashRow: "opencode_operator_global_status",
    port: () => openCodeOperatorGlobalStatus(fixture().globalFile, operatorGlobalSeed()),
  },
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

const THE_VERIFY_CORPUS =
  "one fixture HOME staged by bootstrap/install-opencode.sh over a seeded operator config and AGENTS.md, then read row " +
  "for row by both bootstrap/verify-opencode.sh's own status functions, sourced and called directly, and by " +
  "core/src/install/verify-opencode.ts — the loop run twice, once with the opencode shim on PATH and once without it";

provedSomething(
  `the verify parity corpus is ${THE_VERIFY_CORPUS}, over ${COMPARED_ROWS.length} of the ` +
    `${OPENCODE_LOCAL_CHECK_ROWS.length} rows bootstrap/verify-opencode.sh emits`,
  COMPARED_ROWS.length === OPENCODE_LOCAL_CHECK_ROWS.filter((row) => THIS_HALF_READS.includes(row.kind)).length,
  "the compared rows are not the host and config rows this half owns, so the loop below proves less than it names",
);

describe("the local-check rows are enumerated from the bash itself, so a row this half never compares cannot go unnamed", () => {
  test("the table names exactly the rows run_local_checks, run_ts_bar and run_shell_syntax emit, in that order", { skip: skipUnlessBash() }, () => {
    assert.deepEqual(bashRowNames(), OPENCODE_LOCAL_CHECK_ROWS.map((row) => row.name));
  });

  test("the rows this half compares are exactly the host and config rows, and every other row is named as deferred", () => {
    const compared = OPENCODE_LOCAL_CHECK_ROWS.filter((row) => THIS_HALF_READS.includes(row.kind)).map((row) => row.name);
    const deferred = OPENCODE_LOCAL_CHECK_ROWS.filter((row) => !THIS_HALF_READS.includes(row.kind)).map((row) => row.name);
    assert.deepEqual(compared, COMPARED_ROWS.map((row) => row.name));
    assert.deepEqual(deferred, [
      "isolated fixture install",
      "nine skill wrappers and shared bodies installed",
      "agent contracts installed",
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

  test("a table that lost a row is caught, so the enumeration above is not a comparison of two empty lists", { skip: skipUnlessBash() }, () => {
    assert.notDeepEqual(bashRowNames().slice(1), OPENCODE_LOCAL_CHECK_ROWS.map((row) => row.name));
    assert.ok(bashRowNames().length > 10, `${bashRowNames().length} row name(s) were read from the bash`);
  });
});

describe("the loop with the opencode shim on PATH, where every row reaches its subject", () => {
  for (const row of COMPARED_ROWS) {
    test(`${row.name}: both implementations read the same verdict`, { skip: skipUnlessBash() }, () => {
      const bash = bashVerifyRow(row.bashRow, fixture(), sandbox, shimmedPath());
      assert.equal(bash.status, 0, bash.stderr);
      assert.equal(row.port(), bash.stdout, `${row.bashRow} disagreed with the port`);
    });
  }

  test("the version row reads the pin through the shim rather than through an installed host binary", { skip: skipUnlessBash() }, () => {
    assert.equal(openCodeVersionStatus(probesOn(shimmedPath())), SUPPORTED_OPENCODE_VERSION);
  });
});

describe("the loop with the shim absent, where the not-on-path result is what both implementations must agree on", () => {
  test("the version row reads opencode-not-on-path through both implementations", { skip: skipUnlessBash() }, () => {
    const bash = bashVerifyRow("opencode_version_status", fixture(), sandbox, bareMachinePath());
    assert.equal(bash.status, 0, bash.stderr);
    assert.equal(bash.stdout, OPENCODE_NOT_ON_PATH);
    assert.equal(openCodeVersionStatus(probesOn(bareMachinePath())), OPENCODE_NOT_ON_PATH);
  });

  for (const row of COMPARED_ROWS.filter((candidate) => candidate.bashRow !== "opencode_version_status")) {
    test(`${row.name}: the same verdict, since the shim's absence never reaches an already-installed fixture`, { skip: skipUnlessBash() }, () => {
      const bash = bashVerifyRow(row.bashRow, fixture(), sandbox, bareMachinePath());
      assert.equal(bash.status, 0, bash.stderr);
      assert.equal(row.port(), bash.stdout, `${row.bashRow} disagreed with the port off the shim`);
    });
  }
});

describe("the PATH both loops are built on, read by resolution alone so the G4 floor stands on every leg rather than on the one that spawns", () => {
  test("the bare path reaches no opencode at all, through the resolution openCodeHostProbes itself performs", () => {
    assert.equal(firstExecutableOnPath(resolutionEnvironment(bareMachinePath()), OPENCODE_BINARY_NAME), undefined);
    assert.equal(openCodeHostProbes(resolutionEnvironment(bareMachinePath())).version, undefined);
  });

  test("a directory holding an opencode is what the filter removes, so the emptiness above is the filter's doing and not this machine's", () => {
    const withShim = fixturePathWith(pathShapeShims());
    assert.equal(pathWithoutOpenCode({ PATH: withShim }), bareMachinePath());
    assert.equal(firstExecutableOnPath(resolutionEnvironment(withShim), OPENCODE_BINARY_NAME), path.join(pathShapeShims(), OPENCODE_BINARY_NAME));
  });
});

describe("every verdict each row can reach is shown on a deliberately broken subject, so no guard inside a row is unread", () => {
  for (const damage of CONFIG_CONTRACT_DAMAGES) {
    test(`a config with ${damage.label} is reported malformed by both implementations`, { skip: skipUnlessBash() }, () => {
      const damaged = damagedFixture(damage);
      const bash = bashVerifyRow("opencode_config_status", damaged, sandbox, shimmedPath());
      assert.equal(bash.stdout, "malformed", bash.stderr);
      assert.equal(openCodeConfigStatus(damaged.configFile), "malformed");
      assert.notEqual(openCodeConfigStatus(damaged.configFile), openCodeConfigStatus(fixture().configFile));
    });
  }

  for (const damage of OPERATOR_KEY_DAMAGES) {
    test(`a config with ${damage.label} is reported dropped by both implementations`, { skip: skipUnlessBash() }, () => {
      const damaged = damagedFixture(damage);
      const bash = bashVerifyRow("opencode_operator_keys_status", damaged, sandbox, shimmedPath());
      assert.equal(bash.stdout, "dropped", bash.stderr);
      assert.equal(openCodeOperatorKeysStatus(damaged.configFile), "dropped");
      assert.notEqual(openCodeOperatorKeysStatus(damaged.configFile), openCodeOperatorKeysStatus(fixture().configFile));
    });
  }

  for (const { damage, verdict } of GLOBAL_DAMAGES) {
    test(`a global file with ${damage.label} is reported ${verdict} by both implementations`, { skip: skipUnlessBash() }, () => {
      const damaged = damagedFixture(damage);
      const bash = bashVerifyRow("opencode_global_status", damaged, sandbox, shimmedPath());
      assert.equal(bash.stdout, verdict, bash.stderr);
      assert.equal(openCodeGlobalStatus(damaged.globalFile, globalBody()), verdict);
    });
  }

  test("a global file whose operator prose was rewritten above the region is reported rewritten by both implementations", { skip: skipUnlessBash() }, () => {
    const damaged = damagedFixture(OPERATOR_PROSE_DAMAGE);
    const bash = bashVerifyRow("opencode_operator_global_status", damaged, sandbox, shimmedPath());
    assert.equal(bash.stdout, "rewritten", bash.stderr);
    assert.equal(openCodeOperatorGlobalStatus(damaged.globalFile, operatorGlobalSeed()), "rewritten");
  });
});

describe(
  "the two divergences C3-S4 measured and did not fix, each pinned as MEASURED and never as ratified (C2-D16) — the name says the behaviour " +
    "awaits the operator's ruling, so a refactor that moves it goes red and the decision that resolves it renames the case",
  () => {
    test(
      'UNRULED, AWAITING THE OPERATOR — C3-S4 residual (7)(a): a falsy non-object mcp "reads valid from the bash and malformed from the port", ' +
        "and this pins that measurement rather than either verdict",
      { skip: skipUnlessBash() },
      () => {
        for (const declaration of FALSY_MCP_DECLARATIONS) {
          const damaged = damagedFixture({ label: `mcp declared ${declaration.named}`, config: (document) => void (document["mcp"] = declaration.value) });
          const bash = bashVerifyRow("opencode_config_status", damaged, sandbox, shimmedPath());
          assert.equal(bash.stdout, "valid", bash.stderr);
          assert.equal(openCodeConfigStatus(damaged.configFile), "malformed");
        }
      },
    );

    test(
      'UNRULED, AWAITING THE OPERATOR — C3-S4 residual (7)(b): an unreadable config "reads malformed and dropped from the bash" and missing from ' +
        "the port for both rows, and this pins that measurement rather than either verdict",
      { skip: skipUnlessBashReadsAnUnreadableConfig() },
      () => {
        const damaged = damagedFixture({ label: "a config no mode lets this user read" });
        const restoredMode = statSync(damaged.configFile).mode;
        chmodSync(damaged.configFile, UNREADABLE_CONFIG_MODE);
        try {
          assert.equal(bashVerifyRow("opencode_config_status", damaged, sandbox, shimmedPath()).stdout, "malformed");
          assert.equal(bashVerifyRow("opencode_operator_keys_status", damaged, sandbox, shimmedPath()).stdout, "dropped");
          assert.equal(openCodeConfigStatus(damaged.configFile), "missing");
          assert.equal(openCodeOperatorKeysStatus(damaged.configFile), "missing");
        } finally {
          chmodSync(damaged.configFile, restoredMode);
        }
      },
    );
  },
);

describe("the seeds this half's rows read are the seeds the bash verifier writes", () => {
  test("seed_operator_config writes the document operatorConfigSeed builds", { skip: skipUnlessBash() }, () => {
    const seedHome = path.join(sandbox, "seed-check");
    const bash = bashVerifyRow("seed_operator_config", fixture(), sandbox, shimmedPath(), [seedHome]);
    assert.equal(bash.status, 0, bash.stderr);
    assert.deepEqual(JSON.parse(readFileSync(path.join(seedHome, "opencode.json"), "utf8")), operatorConfigSeed());
  });
});

function skipUnlessBash(): false | string {
  const platformSkip = skipUnlessBashRunsTheInstallerPipeline();
  if (platformSkip !== false) return platformSkip;
  if (!bashIsAvailable()) return "bash cannot be spawned here, so bootstrap/verify-opencode.sh cannot be sourced as the oracle";
  return false;
}

function skipUnlessBashReadsAnUnreadableConfig(): false | string {
  const chmodSkip = skipUnlessChmodMakesFilesUnreadable();
  return chmodSkip !== false ? chmodSkip : skipUnlessBash();
}

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

function bashRowNames(): string[] {
  const source = readFileSync(VERIFY_SCRIPT, "utf8");
  return [...checkNamesIn(source, "run_local_checks"), ...checkNamesIn(source, "run_ts_bar"), ...checkNamesIn(source, "run_shell_syntax")];
}

function checkNamesIn(source: string, functionName: string): string[] {
  const body = source.slice(source.indexOf(`${functionName}() {`));
  const named = [...body.slice(0, body.indexOf("\n}")).matchAll(/\bcheck "([^"]+)"/g)].map((match) => match[1] as string);
  return [...new Set(named)];
}
