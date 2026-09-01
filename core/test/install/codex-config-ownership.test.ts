import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { CONFIG_MARKER_END, CONFIG_MARKER_START, FEATURE_MARKER_END, FEATURE_MARKER_START } from "../../src/install/codex-config.ts";
import { inspectCodexConfig, OSO_OWNED_CONFIG_PATHS, rebuildManagedConfig } from "../../src/install/codex.ts";
import { provedSomething } from "../support/proved.ts";

const FALLOW_COMMAND = "/usr/bin/fallow-mcp";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-codex-ownership-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const fixtureHome = path.join(sandbox, "home");
const codexHome = path.join(fixtureHome, ".codex");
const runtimeRoot = path.join(fixtureHome, ".local", "share", "oso-code", "runtime");

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
  { named: "default_permissions at root outside the region", text: 'default_permissions = "oso"\n\n[history]\nx = 1\n', owned: true },
  { named: "[agents] outside the region", text: "[agents]\nmax_threads = 4\n", owned: true },
  { named: "[shell_environment_policy.set] outside the region", text: '[shell_environment_policy.set]\nOSO_AGENT = "1"\n', owned: true },
  { named: "[mcp_servers.context7] outside the region", text: '[mcp_servers.context7]\nurl = "https://example.invalid"\n', owned: true },
  { named: "[mcp_servers.fallow] outside the region", text: '[mcp_servers.fallow]\ncommand = "x"\n', owned: true },
  { named: "[permissions.oso] outside the region", text: '[permissions.oso]\nextends = ":workspace"\n', owned: true },
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
      const once = rebuildManagedConfig(text, codexHome, runtimeRoot, FALLOW_COMMAND);
      const twice = rebuildManagedConfig(once, codexHome, runtimeRoot, FALLOW_COMMAND);
      assert.equal(rebuildManagedConfig(twice, codexHome, runtimeRoot, FALLOW_COMMAND), twice);
      for (const line of text.split("\n").filter((candidate) => candidate.trim() !== "")) {
        assert.ok(once.includes(line), `${JSON.stringify(line)} did not survive the rebuild:\n${once}`);
      }
    });
  }

  test("a config carrying root keys is a fixed point from the first rebuild on, which is the shape an installed host holds", () => {
    const once = rebuildManagedConfig('model = "x"\n\n[history]\ny = 1\n', codexHome, runtimeRoot, FALLOW_COMMAND);
    assert.equal(rebuildManagedConfig(once, codexHome, runtimeRoot, FALLOW_COMMAND), once);
  });

  test("a root-key-less config settles after the second rebuild rather than growing a blank line per run", () => {
    const once = rebuildManagedConfig("", codexHome, runtimeRoot, FALLOW_COMMAND);
    const twice = rebuildManagedConfig(once, codexHome, runtimeRoot, FALLOW_COMMAND);
    assert.equal(twice, `\n${once}`);
    assert.equal(rebuildManagedConfig(twice, codexHome, runtimeRoot, FALLOW_COMMAND), twice);
  });

  test("the unmanaged part survives the rebuild byte for byte, comments and all", () => {
    const operator = '# an operator comment nobody owns\nmodel = "gpt-5"\n\n[history]\npersistence = "save-all"\n';
    const rebuilt = rebuildManagedConfig(operator, codexHome, runtimeRoot, FALLOW_COMMAND);
    assert.ok(rebuilt.startsWith('# an operator comment nobody owns\nmodel = "gpt-5"\n'));
    assert.ok(rebuilt.includes('[history]\npersistence = "save-all"\n'));
    assert.ok(rebuilt.includes(`${CONFIG_MARKER_START}\n`) && rebuilt.includes(`${CONFIG_MARKER_END}\n`));
    assert.ok(rebuilt.includes(`${FEATURE_MARKER_START}\n`) && rebuilt.includes(`${FEATURE_MARKER_END}\n`));
  });

  test("a CRLF operator line keeps its carriage return, which is the byte a trim would eat", () => {
    const rebuilt = rebuildManagedConfig('model = "gpt-5"\r\n\r\n[history]\r\nx = 1\r\n', codexHome, runtimeRoot, FALLOW_COMMAND);
    assert.ok(rebuilt.startsWith('model = "gpt-5"\r\n\r\n'));
    assert.ok(rebuilt.includes("[history]\r\nx = 1\r\n"));
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
    const refusal = inspectCodexConfig('[permissions.oso]\nextends = ":workspace"\n', "config.toml");
    assert.deepEqual(refusal, { kind: "owned-key-outside-the-region", keyPath: "permissions.oso" });
  });

  test("a config the parser cannot read is refused as unparseable rather than rebuilt blind", () => {
    const refusal = inspectCodexConfig("model = \n", "config.toml");
    assert.equal(refusal?.kind, "unparseable");
  });

  test("the parser is never asked to re-emit: every byte the rebuild writes outside the region came from the input", () => {
    const operator = "# keep me\nkey = 'literal \\ value'\n\n[history]\nx = 1\n";
    const rebuilt = rebuildManagedConfig(operator, codexHome, runtimeRoot, FALLOW_COMMAND);
    assert.ok(rebuilt.includes("# keep me\nkey = 'literal \\ value'\n"));
  });
});

