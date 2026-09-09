import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  CONFIG_MARKER_END,
  CONFIG_MARKER_START,
  FEATURE_MARKER_END,
  FEATURE_MARKER_START,
  renderCodexManagedConfig,
} from "../../src/install/codex-config.ts";
import {
  codexPermissionsNotice,
  inspectCodexConfig,
  operatorAgentsNotice,
  operatorPermissionsNotice,
  OSO_OWNED_CONFIG_PATHS,
  rebuildManagedConfig,
} from "../../src/install/codex.ts";
import { parseTomlDocument } from "../../src/install/toml.ts";
import { insideTheManagedRegion, PREVIOUS_RELEASE_CONFIG, RELEASED_PERMISSION_KEYS } from "../support/codex-install-fixture.ts";
import { provedSomething } from "../support/proved.ts";

const FALLOW_COMMAND = "/usr/bin/fallow-mcp";
const OPERATOR_AGENTS_CONFIG =
  '[agents]\nmax_threads = 6\njob_max_runtime_seconds = 900\n\n[agents.reviewer]\ndescription = "an operator role"\n';

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-codex-ownership-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const fixtureHome = path.join(sandbox, "home");
const codexHome = path.join(fixtureHome, ".codex");
const configFile = path.join(codexHome, "config.toml");
const runtimeRoot = path.join(fixtureHome, ".local", "share", "oso-code", "runtime");

function rebuilt(existingText: string): string {
  return rebuildManagedConfig({ existingText, configFile, targetHome: fixtureHome, runtimeRoot, fallowCommand: FALLOW_COMMAND });
}


const OPERATOR_SHAPES: readonly Readonly<{ named: string; text: string }>[] = [
  { named: "an absent config, which the installer creates", text: "" },
  { named: "a config holding one empty line alone", text: "\n" },
  {
    named: "operator root keys and one operator table",
    text: '# an operator comment nobody owns\nmodel = "gpt-5"\n\n[history]\npersistence = "save-all"\n',
  },
  { named: "operator tables alone, no root keys", text: '[history]\npersistence = "save-all"\n\n[tui]\ntheme = "dark"\n' },
  { named: "an operator features table with its own keys", text: "[features]\noperator_flag = true\n\n[history]\nx = 1\n" },
  { named: "a CRLF operator config", text: 'model = "gpt-5"\r\n\r\n[history]\r\nx = 1\r\n' },
  { named: "blank and comment lines hugging the insertion point", text: '# a\n\n\n# b\nmodel = "x"\n\n\n\n[history]\nx = 1\n' },
  { named: "an operator config whose last line carries no newline", text: 'model = "x"\n\n[history]\nx = 1' },
  {
    named: "an operator multiline string holding a marker-looking line",
    text: 'notice = """\n# oso-code:start\nnot ownership\n"""\n\n[history]\nx = 1\n',
  },
  { named: "an operator engram MCP server, which oso-code does not own", text: '[mcp_servers.engram]\ncommand = "engram"\n' },
];

const OWNED_KEY_SHAPES: readonly Readonly<{ named: string; text: string; owned: boolean }>[] = [
  { named: "default_permissions at root outside the region, which the operator picks and oso-code only seeds", text: 'default_permissions = "oso"\n\n[history]\nx = 1\n', owned: false },
  { named: "[agents] outside the region, which Codex owns and oso-code no longer writes", text: "[agents]\nmax_threads = 4\n", owned: false },
  { named: "[shell_environment_policy.set] outside the region", text: '[shell_environment_policy.set]\nOSO_AGENT = "1"\n', owned: true },
  { named: "[mcp_servers.context7] outside the region", text: '[mcp_servers.context7]\nurl = "https://example.invalid"\n', owned: true },
  { named: "[mcp_servers.fallow] outside the region", text: '[mcp_servers.fallow]\ncommand = "x"\n', owned: true },
  { named: "[permissions.oso] outside the region, which is where a seeded profile lives", text: '[permissions.oso]\nextends = ":workspace"\n', owned: false },
  { named: "[mcp_servers.engram] outside the region, which oso-code does not own", text: '[mcp_servers.engram]\ncommand = "engram"\n', owned: false },
  { named: "an operator-only config naming none of the owned keys", text: 'model = "x"\n\n[history]\ny = 1\n', owned: false },
  { named: "[permissions.operator], whose name only starts like the owned one", text: '[permissions.operator]\nextends = ":workspace"\n', owned: false },
];

provedSomething(
  `${OPERATOR_SHAPES.length} operator config shape(s) and ${OWNED_KEY_SHAPES.length} owned-key shape(s) were driven ` +
    "through rebuildManagedConfig and inspectCodexConfig over a fixture CODEX_HOME",
  OPERATOR_SHAPES.length >= 8 && OWNED_KEY_SHAPES.filter((shape) => shape.owned).length === OSO_OWNED_CONFIG_PATHS.length,
  `${OPERATOR_SHAPES.length} operator shape(s) and ${OWNED_KEY_SHAPES.filter((shape) => shape.owned).length} of the ` +
    `${OSO_OWNED_CONFIG_PATHS.length} owned key path(s) were exercised, so a clean result would leave a row unmeasured`,
);

describe("row one: the Codex config.toml managed region, region-rebuild between the exact marker pair", () => {
  for (const { named, text } of OPERATOR_SHAPES) {
    test(`${named}: the rebuild settles by its second run and leaves every operator byte outside the region alone`, () => {
      const once = rebuilt(text);
      const twice = rebuilt(once);
      assert.equal(rebuilt(twice), twice);
      for (const line of text.split("\n").filter((candidate) => candidate.trim() !== "")) {
        assert.ok(once.includes(line), `${JSON.stringify(line)} did not survive the rebuild:\n${once}`);
      }
    });
  }

  test("a config carrying root keys is a fixed point from the first rebuild on, which is the shape an installed host holds", () => {
    const once = rebuilt('model = "x"\n\n[history]\ny = 1\n');
    assert.equal(rebuilt(once), once);
  });

  test("a root-key-less config is a fixed point too, because the seeded default gives it a root key of its own", () => {
    const once = rebuilt("");
    assert.equal(rebuilt(once), once);
  });

  test("the unmanaged part survives the rebuild byte for byte, comments and all", () => {
    const operator = '# an operator comment nobody owns\nmodel = "gpt-5"\n\n[history]\npersistence = "save-all"\n';
    const once = rebuilt(operator);
    assert.ok(once.startsWith('# an operator comment nobody owns\nmodel = "gpt-5"\n'));
    assert.ok(once.includes('[history]\npersistence = "save-all"\n'));
    assert.ok(once.includes(`${CONFIG_MARKER_START}\n`) && once.includes(`${CONFIG_MARKER_END}\n`));
    assert.ok(once.includes(`${FEATURE_MARKER_START}\n`) && once.includes(`${FEATURE_MARKER_END}\n`));
  });

  test("a CRLF operator line keeps its carriage return, which is the byte a trim would eat", () => {
    const once = rebuilt('model = "gpt-5"\r\n\r\n[history]\r\nx = 1\r\n');
    assert.ok(once.startsWith('model = "gpt-5"\r\n\r\n'));
    assert.ok(once.includes("[history]\r\nx = 1\r\n"));
  });
});

describe("row two: oso-owned keys outside the region are preserved, validated, and never re-emitted", () => {
  for (const { named, text, owned } of OWNED_KEY_SHAPES) {
    test(`${named}: the port refuses exactly where this table says it must`, () => {
      const refusal = inspectCodexConfig(text, "config.toml");
      assert.equal(refusal?.kind === "owned-key-outside-the-region", owned, JSON.stringify(refusal));
    });
  }

  test("the refusal names the key path it found, never a bare verdict", () => {
    const refusal = inspectCodexConfig('[shell_environment_policy.set]\nOSO_AGENT = "1"\n', "config.toml");
    assert.deepEqual(refusal, { kind: "owned-key-outside-the-region", keyPath: "shell_environment_policy.set" });
  });

  test("a config the parser cannot read is refused as unparseable rather than rebuilt blind", () => {
    const refusal = inspectCodexConfig("model = \n", "config.toml");
    assert.equal(refusal?.kind, "unparseable");
  });

  test("the parser is never asked to re-emit: every byte the rebuild writes outside the region came from the input", () => {
    const operator = "# keep me\nkey = 'literal \\ value'\n\n[history]\nx = 1\n";
    assert.ok(rebuilt(operator).includes("# keep me\nkey = 'literal \\ value'\n"));
  });
});

describe("row three: Codex owns its own subagent threads, so the managed region names none of their settings", () => {
  for (const released of ["[agents]", "max_threads", "max_depth", "job_max_runtime_seconds"]) {
    test(`the rendered managed region writes no ${released}, and the unrelated glob_scan_max_depth is no false positive`, () => {
      const lines = renderCodexManagedConfig(runtimeRoot, FALLOW_COMMAND).split("\n");
      assert.deepEqual(lines.filter((line) => line === released || line.startsWith(`${released} =`)), []);
    });
  }

  test("an operator [agents] outside the region admits the install rather than refusing it", () => {
    assert.equal(inspectCodexConfig(OPERATOR_AGENTS_CONFIG, "config.toml"), undefined);
  });

  test("an operator [agents] survives the rebuild byte for byte", () => {
    assert.ok(rebuilt(OPERATOR_AGENTS_CONFIG).includes("[agents]\nmax_threads = 6\njob_max_runtime_seconds = 900\n"));
  });

  test("the operator's own agent settings are named with their values, nested roles included", () => {
    assert.equal(
      operatorAgentsNotice(OPERATOR_AGENTS_CONFIG, "config.toml"),
      `Codex [agents] is the operator's own: max_threads = 6, job_max_runtime_seconds = 900, reviewer.description = "an operator role"`,
    );
  });

  test("a config naming no [agents] names nothing, so the report stays silent instead of inventing a default", () => {
    assert.equal(operatorAgentsNotice('model = "gpt-5"\n\n[history]\nx = 1\n', "config.toml"), undefined);
  });

  test("the region oso-code writes is never named as the operator's own", () => {
    assert.equal(operatorAgentsNotice(rebuilt(""), "config.toml"), undefined);
  });
});

describe("row four: Codex permissions belong to the operator — seeded once, migrated once, never re-owned", () => {
  for (const released of RELEASED_PERMISSION_KEYS) {
    test(`the rendered managed region carries no ${released}`, () => {
      assert.equal(renderCodexManagedConfig(runtimeRoot, FALLOW_COMMAND).includes(released), false);
    });
  }

  test("the owned paths are the three the harness still wires, and neither released key is among them", () => {
    assert.deepEqual(
      OSO_OWNED_CONFIG_PATHS.map((keyPath) => keyPath.join(".")),
      ["shell_environment_policy.set", "mcp_servers.context7", "mcp_servers.fallow"],
    );
  });

  test("a first install on a config with nothing of its own seeds a ready-to-use default outside the region", () => {
    const seeded = rebuilt("");
    const document = parseTomlDocument(seeded, configFile);
    const profile = (document["permissions"] as Record<string, Record<string, unknown>>)["oso"] as Record<string, unknown>;
    assert.equal(document["default_permissions"], "oso");
    assert.equal(profile["extends"], ":workspace");
    assert.deepEqual(Object.keys(profile["workspace_roots"] as object), [
      `${fixtureHome}/.local/state/oso-code`,
      `${fixtureHome}/.local/state/oso-code/worktrees`,
    ]);
    assert.deepEqual(RELEASED_PERMISSION_KEYS.filter((released) => insideTheManagedRegion(seeded).includes(released)), []);
  });

  test("a second rebuild over an operator-edited profile leaves the whole config byte for byte", () => {
    const edited = rebuilt("")
      .replace('default_permissions = "oso"', 'default_permissions = "mine"')
      .replace("[permissions.oso]", "[permissions.mine]");
    assert.equal(rebuilt(edited), edited);
  });

  test("an operator who deleted the seeded profile keeps it deleted rather than having it re-imposed", () => {
    const kept = 'default_permissions = ":workspace"\n\n[history]\nx = 1\n';
    const once = rebuilt(kept);
    assert.equal(parseTomlDocument(once, configFile)["default_permissions"], ":workspace");
    assert.equal(once.includes("[permissions.oso]"), false);
  });

  test("the one-time migration lifts both released keys out of the region with their values intact", () => {
    const migrated = rebuilt(PREVIOUS_RELEASE_CONFIG);
    assert.deepEqual(RELEASED_PERMISSION_KEYS.filter((released) => insideTheManagedRegion(migrated).includes(released)), []);
    const document = parseTomlDocument(migrated, configFile);
    const profile = (document["permissions"] as Record<string, Record<string, unknown>>)["oso"] as Record<string, unknown>;
    assert.equal(document["default_permissions"], "oso");
    assert.equal(profile["extends"], ":workspace");
    assert.deepEqual(profile["workspace_roots"], { "/somewhere/the/operator/kept": true });
    assert.deepEqual(profile["filesystem"], { ":workspace_roots": { "**/.env": "deny" } });
    assert.equal(rebuilt(migrated), migrated);
  });

  test("operator content inside the region that the renderer never emits is lifted out rather than dropped", () => {
    const document = parseTomlDocument(rebuilt(PREVIOUS_RELEASE_CONFIG), configFile);
    assert.deepEqual(
      [document["model"], document["model_reasoning_effort"], document["service_tier"]],
      ["gpt-6-astra", "xhigh", "default"],
    );
  });

  test("the notice names the seed, the migration, and the operator's own, and verify names only the last", () => {
    assert.match(codexPermissionsNotice("", configFile), /^Codex permissions are seeded once outside the managed region/);
    assert.match(
      codexPermissionsNotice(PREVIOUS_RELEASE_CONFIG, configFile),
      /^Codex permissions move out of the managed region and stay the operator's own: default_permissions = "oso", \[permissions\.oso\]$/,
    );
    const seeded = rebuilt("");
    assert.equal(
      codexPermissionsNotice(seeded, configFile),
      `Codex permissions are the operator's own: default_permissions = "oso", [permissions.oso]`,
    );
    assert.equal(operatorPermissionsNotice(seeded, configFile), codexPermissionsNotice(seeded, configFile));
    assert.equal(operatorPermissionsNotice(PREVIOUS_RELEASE_CONFIG, configFile), undefined);
  });
});

