import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { resolveFallowMcpCommand } from "../../src/install/codex-config.ts";
import {
  HARNESS_EXTERNAL_DIRECTORIES,
  HARNESS_EXTERNAL_DIRECTORY_VERDICT,
  hostContractViolationOf,
  mergeOpenCodeConfig,
  OpenCodeConfigRefusal,
  OPENCODE_CONFIG_SCHEMA_URL,
  ownedMcpServers,
  type ConfigDocument,
} from "../../src/install/opencode-config.ts";
import { provedSomething } from "../support/proved.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-opencode-ownership-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const THE_OWNERSHIP_CORPUS =
  "one operator seed carrying every owned container and one operator key inside each, merged by mergeOpenCodeConfig and " +
  "read back as the rendered document plus its preserved-key ledger, against the eight rows spelled row by row below";

const OPERATOR_SEED = {
  theme: "operator-theme",
  $schema: "https://operator.example/own.json",
  notes: "cañón — ünïcode",
  plugin: ["operator-plugin"],
  permission: {
    read: "allow",
    question: "deny",
    skill: { "operator-skill": "allow", "oso-plan": "allow" },
    task: { "operator-*": "deny", "*": "deny" },
    external_directory: { "~/operator-tree/**": "allow", "~/.config/opencode/**": "ask" },
  },
  mcp: {
    "operator-server": { type: "local", command: ["operator-cli"], enabled: true, environment: {} },
    engram: { type: "local", command: ["operator-engram"], enabled: false, environment: {} },
  },
} as const;

const EXPECTED_PRESERVED_ORDER = [
  "theme",
  "$schema",
  "notes",
  "permission.read",
  "permission.skill.operator-skill",
  "permission.task.operator-*",
  "permission.external_directory.~/operator-tree/**",
  "mcp.operator-server",
];

const WIN32_FALLOW_COMMAND = "C:\\Users\\operator\\AppData\\Roaming\\npm\\fallow-mcp";

const PYTHON_FALSY_SERVER_DECLARATIONS: readonly unknown[] = [false, 0, "", null, [], {}];

const fallowCommand = fixtureFallowCommand();

provedSomething(
  `the ownership corpus is ${THE_OWNERSHIP_CORPUS}, over ${EXPECTED_PRESERVED_ORDER.length} preserved key(s)`,
  fallowCommand !== "" && EXPECTED_PRESERVED_ORDER.length === 8,
  "no fixture fallow-mcp was written, or the preserved ledger is not the eight-key ledger this seed builds",
);

describe("the eight ownership rows, each spelled here and then read back off the merged document", () => {
  test("row 1 — permission.* is overwritten: an operator's question=deny becomes allow", () => {
    assert.equal(permissionOf(portSeeded())["question"], "allow");
  });

  test("row 2 — permission.skill.<mode> is overwritten: allow becomes deny for every owned mode", () => {
    const skills = plainObject(permissionOf(portSeeded())["skill"]);
    assert.deepEqual(skills, { "operator-skill": "allow", "oso-plan": "deny", "oso-quick": "deny", "oso-debug": "deny", "oso-roadmap": "deny" });
  });

  test('row 3 — permission.task["*"] is overwritten: deny becomes allow, the operator pattern untouched', () => {
    assert.deepEqual(plainObject(permissionOf(portSeeded())["task"]), { "operator-*": "deny", "*": "allow" });
  });

  test("row 4 — mcp.* is insert-if-missing: an operator's own engram declaration survives, context7 and fallow are added", () => {
    const servers = plainObject(portSeeded()["mcp"]);
    assert.deepEqual(servers["engram"], OPERATOR_SEED.mcp.engram);
    assert.deepEqual(servers["context7"], ownedMcpServers(fallowCommand).context7);
    assert.deepEqual(servers["fallow"], ownedMcpServers(fallowCommand).fallow);
  });

  test("row 5 — $schema is insert-if-missing: an operator's own URL survives, an absent one becomes oso's", () => {
    assert.equal(portSeeded()["$schema"], OPERATOR_SEED.$schema);
    assert.equal(portOf({})["$schema"], OPENCODE_CONFIG_SCHEMA_URL);
  });

  test("row 6 — plugin is create-if-absent, never re-emitted: a present array passes through, an absent one becomes []", () => {
    assert.deepEqual(portSeeded()["plugin"], ["operator-plugin"]);
    assert.deepEqual(portOf({})["plugin"], []);
  });

  test("row 7 — permission.external_directory.<harness path> is overwritten to allow, and no path outside the three is added", () => {
    assert.deepEqual(plainObject(permissionOf(portSeeded())["external_directory"]), {
      "~/operator-tree/**": "allow",
      ...Object.fromEntries(HARNESS_EXTERNAL_DIRECTORIES.map((directory) => [directory, HARNESS_EXTERNAL_DIRECTORY_VERDICT])),
    });
  });

  test("row 8 — everything else is preserved: the ledger names the same keys in the same order", () => {
    assert.deepEqual([...portSeededMerge().preservedKeys], EXPECTED_PRESERVED_ORDER);
  });
});

describe("the rendered bytes, and the recorded divergence from the escaping the bash renderer used", () => {
  test("a non-ASCII operator value is emitted as UTF-8 rather than escaped, and parses back to the value the seed carried", () => {
    const rendered = renderedText(seedCopy());
    assert.match(rendered, /cañón/);
    assert.doesNotMatch(rendered, /ca\\u00f1\\u00f3n/);
    assert.equal((JSON.parse(rendered) as ConfigDocument)["notes"], OPERATOR_SEED.notes);
  });
});

describe("the three refusals the merge aborts on rather than writing", () => {
  for (const [label, seed, message] of [
    ["a config that is not a JSON object", "[1, 2]", "the existing opencode.json is not a JSON object"],
    ["a non-array plugin", '{"plugin": "nope"}', 'the existing opencode.json holds a non-array "plugin"; fix it and re-run'],
    ["a non-object owned container", '{"permission": []}', 'the existing opencode.json holds a non-object "permission"; fix it and re-run'],
  ] as const) {
    test(`${label}: the merge refuses with the words this table spells, and renders nothing`, () => {
      assert.throws(
        () => mergeOpenCodeConfig(JSON.parse(seed), fallowCommand),
        (error: unknown) => error instanceof OpenCodeConfigRefusal && error.message === message,
      );
    });
  }
});

describe("the win32 cell of every owned value, measured rather than reasoned", () => {
  test("exactly one owned value composes a host path: every other rendered byte is identical across two fallow commands", () => {
    const posix = renderedText(seedCopy(), "/usr/local/bin/fallow-mcp");
    const win32 = renderedText(seedCopy(), WIN32_FALLOW_COMMAND);
    const differing = differingLines(posix, win32);
    assert.deepEqual(differing, [`        "${WIN32_FALLOW_COMMAND.replaceAll("\\", "\\\\")}"`]);
  });

  test("that one value is escaped by JSON alone and decodes back to the native path, so nothing normalises it on the way out", () => {
    const document = mergeOpenCodeConfig(seedCopy(), WIN32_FALLOW_COMMAND).document;
    const rendered = JSON.stringify(document, null, 2);
    assert.match(rendered, /"C:\\\\Users\\\\operator\\\\AppData\\\\Roaming\\\\npm\\\\fallow-mcp"/);
    assert.deepEqual(plainObject(plainObject((JSON.parse(rendered) as ConfigDocument)["mcp"])["fallow"])["command"], [WIN32_FALLOW_COMMAND]);
  });

  test("the merge reads no platform of its own, so the same input renders the same bytes whatever platform the caller is on", () => {
    assert.equal(renderedText(seedCopy(), WIN32_FALLOW_COMMAND), renderedText(seedCopy(), WIN32_FALLOW_COMMAND));
    assert.equal(hostContractViolationOf(mergeOpenCodeConfig(seedCopy(), WIN32_FALLOW_COMMAND).document), undefined);
  });

  test("the fallow command the resolver returns is the one the merged document declares, so the row inherits the Codex measurement rather than a fresh one", () => {
    const resolution = resolveFallowMcpCommand(path.join(sandbox, "home"), {}, () => undefined, () => fallowCommand);
    assert.equal(resolution.command, fallowCommand);
    const servers = plainObject(portSeeded()["mcp"]);
    assert.deepEqual(plainObject(servers["fallow"])["command"], [fallowCommand]);
  });
});

describe("the host contract the merge asserts over its own output", () => {
  test("the rendered document passes it, and each violation is named rather than reported as one failure", () => {
    const rendered = mergeOpenCodeConfig(seedCopy(), fallowCommand).document;
    assert.equal(hostContractViolationOf(rendered), undefined);
    assert.equal(hostContractViolationOf({ ...rendered, plugin: "nope" }), "plugin must be an array");
    assert.equal(hostContractViolationOf(withMcp(rendered, { context7: {} })), "context7 MCP server is missing");
    assert.equal(hostContractViolationOf(withMcp(rendered, { operator: { env: {} } })), "MCP server uses the env key, not environment: operator");
    assert.equal(hostContractViolationOf(withMcp(rendered, { operator: [] })), "malformed MCP server: operator");
  });

  test("an owned MCP server declared any value read as false is MISSING rather than malformed, since the contract asserts truthiness and not a type", () => {
    const rendered = mergeOpenCodeConfig(seedCopy(), fallowCommand).document;
    for (const declaration of PYTHON_FALSY_SERVER_DECLARATIONS) {
      assert.equal(
        hostContractViolationOf(withMcp(rendered, { context7: declaration })),
        "context7 MCP server is missing",
        `context7 declared ${JSON.stringify(declaration)}`,
      );
    }
  });

  for (const [grantBoundTool, violation] of [
    ["oso_plan_approve", "the plan approval tool must carry permission ask"],
    ["oso_plan_cancel", "the plan cancel tool must carry permission ask"],
  ] as const) {
    test(`the ${grantBoundTool} verdict the host contract pins is caught when it is anything but ask`, () => {
      const rendered = mergeOpenCodeConfig(seedCopy(), fallowCommand).document;
      const permission = { ...plainObject(rendered["permission"]), [grantBoundTool]: "allow" };
      assert.equal(hostContractViolationOf({ ...rendered, permission }), violation);
    });
  }
});

function portSeededMerge() {
  return mergeOpenCodeConfig(seedCopy(), fallowCommand);
}

function portSeeded(): ConfigDocument {
  return portSeededMerge().document;
}

function portOf(existing: ConfigDocument): ConfigDocument {
  return mergeOpenCodeConfig(existing, fallowCommand).document;
}

function renderedText(existing: ConfigDocument, command: string = fallowCommand): string {
  return `${JSON.stringify(mergeOpenCodeConfig(existing, command).document, null, 2)}\n`;
}

function seedCopy(): ConfigDocument {
  return JSON.parse(JSON.stringify(OPERATOR_SEED)) as ConfigDocument;
}

function permissionOf(document: ConfigDocument): ConfigDocument {
  return plainObject(document["permission"]);
}

function plainObject(value: unknown): ConfigDocument {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${JSON.stringify(value)} is not a JSON object`);
  return value as ConfigDocument;
}

function withMcp(document: ConfigDocument, servers: ConfigDocument): ConfigDocument {
  return { ...document, mcp: { ...plainObject(document["mcp"]), ...servers } };
}

function differingLines(left: string, right: string): string[] {
  const leftLines = left.split("\n");
  return right.split("\n").filter((line, index) => line !== leftLines[index]);
}

function fixtureFallowCommand(): string {
  const binDirectory = path.join(sandbox, "fixture-bin");
  mkdirSync(binDirectory, { recursive: true });
  const command = path.join(binDirectory, "fallow-mcp");
  writeFileSync(command, "#!/bin/sh\nexit 0\n");
  chmodSync(command, 0o700);
  return command;
}
