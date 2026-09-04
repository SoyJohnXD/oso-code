import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { opencodePathsFor } from "../../src/install/opencode.ts";
import { firstExecutableOnPath } from "../../src/install/verify-claude.ts";
import { ENGRAM_BINARY_NAME, openCodePayloadSources } from "../../src/install/opencode-install.ts";
import { mcpServerWildcard } from "../../src/install/opencode-config.ts";
import {
  openCodeAgentMcpSurfaceStatus,
  openCodeAgentStatus,
  openCodeCommandStatus,
  openCodeConfigHomeGuardStatus,
  openCodeEngramStatus,
  openCodePluginStatus,
  openCodeRegistryStatus,
  openCodeSkillStatus,
  openCodeTrustBytesStatus,
  shellSourcesUnder,
  stageOpenCodeFixture,
  treesHoldTheSameBytes,
  verifyOpenCode,
  OPENCODE_LOCAL_CHECK_ROWS,
  type LocalCheckRowKind,
} from "../../src/install/verify-opencode.ts";
import {
  fixtureEnvironment,
  fixturePathWith,
  pathWithout,
  stageInstalledFixture,
  type StagedFixture,
} from "../support/opencode-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { posixSpelled } from "../support/repository-paths.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";
import { skipUnlessPathResolvesExtensionlessNames } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-opencode-artifacts-"));
mkdirSync(path.join(sandbox, "tmp"), { recursive: true });
after(() => rmSync(sandbox, { recursive: true, force: true }));

const THIS_HALF_READS: readonly LocalCheckRowKind[] = ["artifact", "repository"];

const ENGRAM_BINARY_NAMES = [ENGRAM_BINARY_NAME, `${ENGRAM_BINARY_NAME}.exe`, `${ENGRAM_BINARY_NAME}.cmd`] as const;

const PUBLISHED_HASHES = openCodePayloadSources(repositoryRoot).publishedHashes;

const COMPARED_ROWS = [
  { name: "nine skill wrappers and the shared skill directory installed", bashRow: "opencode_skill_status", port: (tree: StagedFixture) => openCodeSkillStatus(repositoryRoot, tree.configHome) },
  { name: "agent contracts installed", bashRow: "opencode_agent_status", port: (tree: StagedFixture) => openCodeAgentStatus(repositoryRoot, tree.configHome) },
  { name: "MCP surface closed on every installed agent", port: (tree: StagedFixture) => openCodeAgentMcpSurfaceStatus(tree.configHome) },
  { name: "mode commands installed and routed", bashRow: "opencode_command_status", port: (tree: StagedFixture) => openCodeCommandStatus(repositoryRoot, tree.configHome) },
  { name: "plugin entry, modules and routes installed", bashRow: "opencode_plugin_status", port: (tree: StagedFixture) => openCodePluginStatus(repositoryRoot, tree.configHome) },
  { name: "Engram plugin file installed", bashRow: "opencode_engram_status", port: (tree: StagedFixture) => openCodeEngramStatus(tree.configHome) },
  { name: "installer-owned targets recorded", bashRow: "opencode_registry_status", port: (tree: StagedFixture) => openCodeRegistryStatus(tree.home, tree.configHome) },
  { name: "published gate bytes as installed", bashRow: "opencode_trust_bytes_status", port: (tree: StagedFixture) => openCodeTrustBytesStatus(PUBLISHED_HASHES, tree.configHome) },
] as const;

type TreeDamage = Readonly<{ label: string; verdict: string; bashRow?: string; apply: (tree: StagedFixture) => void; port: (tree: StagedFixture) => string }>;

const TREE_DAMAGES: readonly TreeDamage[] = [
  {
    label: "one installed skill wrapper rewritten",
    verdict: "divergent: oso-plan",
    bashRow: "opencode_skill_status",
    apply: (tree) => writeFileSync(path.join(tree.configHome, "skill", "oso-plan", "SKILL.md"), "rewritten\n"),
    port: (tree) => openCodeSkillStatus(repositoryRoot, tree.configHome),
  },
  {
    label: "one skill wrapper's references/ directory removed, its SKILL.md left untouched",
    verdict: "divergent: oso-plan",
    bashRow: "opencode_skill_status",
    apply: (tree) => rmSync(path.join(tree.configHome, "skill", "oso-plan", "references"), { recursive: true, force: true }),
    port: (tree) => openCodeSkillStatus(repositoryRoot, tree.configHome),
  },
  {
    label: "the shared skill references/ directory removed",
    verdict: "shared-differs",
    bashRow: "opencode_skill_status",
    apply: (tree) => rmSync(path.join(tree.configHome, "skill", "_shared", "references"), { recursive: true, force: true }),
    port: (tree) => openCodeSkillStatus(repositoryRoot, tree.configHome),
  },
  {
    label: "one shared skill file edited",
    verdict: "shared-differs",
    bashRow: "opencode_skill_status",
    apply: (tree) => appendToFirstSharedFile(tree),
    port: (tree) => openCodeSkillStatus(repositoryRoot, tree.configHome),
  },
  {
    label: "one installed agent contract deleted",
    verdict: "count:",
    bashRow: "opencode_agent_status",
    apply: (tree) => rmSync(path.join(tree.configHome, "agent", firstAgentName()), { force: true }),
    port: (tree) => openCodeAgentStatus(repositoryRoot, tree.configHome),
  },
  {
    label: "one installed agent contract rewritten",
    verdict: "divergent: ",
    bashRow: "opencode_agent_status",
    apply: (tree) => writeFileSync(path.join(tree.configHome, "agent", firstAgentName()), "rewritten\n"),
    port: (tree) => openCodeAgentStatus(repositoryRoot, tree.configHome),
  },
  {
    label: "one installed agent block letting the engram server back through",
    verdict: "open: oso-verifier.md:engram_*",
    apply: (tree) => withoutEngramDeny(path.join(tree.configHome, "agent", "oso-verifier.md")),
    port: (tree) => openCodeAgentMcpSurfaceStatus(tree.configHome),
  },
  {
    label: "one installed agent contract deleted, leaving the MCP surface unreadable on a short tree",
    verdict: "count:",
    apply: (tree) => rmSync(path.join(tree.configHome, "agent", firstAgentName()), { force: true }),
    port: (tree) => openCodeAgentMcpSurfaceStatus(tree.configHome),
  },
  {
    label: "one installed mode command rewritten",
    verdict: "divergent: oso-plan.md",
    bashRow: "opencode_command_status",
    apply: (tree) => writeFileSync(path.join(tree.configHome, "command", "oso-plan.md"), "rewritten\n"),
    port: (tree) => openCodeCommandStatus(repositoryRoot, tree.configHome),
  },
  {
    label: "the plugin entry bundle rewritten",
    verdict: "entry-divergent",
    bashRow: "opencode_plugin_status",
    apply: (tree) => writeFileSync(path.join(tree.configHome, "plugin", "oso-code.js"), "rewritten\n"),
    port: (tree) => openCodePluginStatus(repositoryRoot, tree.configHome),
  },
  {
    label: "an unbundled plugin source left beside the entry",
    verdict: "unbundled-sources:1",
    bashRow: "opencode_plugin_status",
    apply: (tree) => writeFileSync(path.join(tree.configHome, "plugin", "leftover.ts"), "export {};\n"),
    port: (tree) => openCodePluginStatus(repositoryRoot, tree.configHome),
  },
  {
    label: "the Engram plugin file removed",
    verdict: "missing",
    bashRow: "opencode_engram_status",
    apply: (tree) => rmSync(path.join(tree.configHome, "plugins", "engram.ts"), { force: true }),
    port: (tree) => openCodeEngramStatus(tree.configHome),
  },
  {
    label: "the owner registry removed",
    verdict: "missing",
    bashRow: "opencode_registry_status",
    apply: (tree) => rmSync(registryFileOf(tree), { force: true }),
    port: (tree) => openCodeRegistryStatus(tree.home, tree.configHome),
  },
  {
    label: "the owner registry's row for the installed agent tree dropped",
    verdict: "missing: .config/opencode/agent",
    bashRow: "opencode_registry_status",
    apply: (tree) => dropRegistryRow(tree, path.join(tree.configHome, "agent")),
    port: (tree) => openCodeRegistryStatus(tree.home, tree.configHome),
  },
  {
    label: "one installed gate script rewritten below its published hash",
    verdict: "bad:",
    bashRow: "opencode_trust_bytes_status",
    apply: (tree) => writeFileSync(path.join(tree.configHome, "hooks", "lib.sh"), "# rewritten\n"),
    port: (tree) => openCodeTrustBytesStatus(PUBLISHED_HASHES, tree.configHome),
  },
];

const FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH = skipUnlessPathResolvesExtensionlessNames();

provedSomething(
  "the artifact corpus is one fixture HOME staged by oso install --host opencode, read row by row over " +
    `${COMPARED_ROWS.length} of the ${OPENCODE_LOCAL_CHECK_ROWS.length} rows the local-check table declares, plus ${TREE_DAMAGES.length} ` +
    "deliberately damaged copies of that HOME, each verdict spelled beside the damage that must produce it",
  COMPARED_ROWS.length > 0 && TREE_DAMAGES.length > 0,
  "no row and no damage were read, so a clean result here would report the same as an empty walk",
);

describe("the rows this half owns are the artifact and repository rows, and the ones it defers are named individually", () => {
  test("the artifact and repository rows are exactly the twelve C3-S4 deferred and the MCP surface row that joined them", () => {
    const owned = OPENCODE_LOCAL_CHECK_ROWS.filter((row) => THIS_HALF_READS.includes(row.kind)).map((row) => row.name);
    assert.deepEqual(owned, [
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

  test("every row this half owns is either compared row for row below, or named here as driven by the assembly instead", () => {
    const compared: readonly string[] = COMPARED_ROWS.map((row) => row.name);
    const drivenByTheAssembly = OPENCODE_LOCAL_CHECK_ROWS.filter((row) => THIS_HALF_READS.includes(row.kind) && !compared.includes(row.name));
    assert.deepEqual(drivenByTheAssembly.map((row) => row.name), [
      "isolated fixture install",
      "an install outside the named home is refused",
      "OpenCode plugin typecheck",
      "OpenCode plugin test suite",
      "repository shell syntax",
    ]);
  });
});

describe("every artifact row reads its passing verdict over one clean staged fixture", () => {
  test("the clean fixture reads the passing verdict this file spells on every row, in the table's order", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const verdicts = COMPARED_ROWS.map((row) => row.port(fixture()));
    assert.deepEqual(verdicts, ["exact", "exact", "closed", "exact", "exact", "present", "installer-owned", "verified"]);
  });
});

describe("every verdict each artifact row can reach is shown on a deliberately broken tree, so no guard inside a row is unread", () => {
  for (const damage of TREE_DAMAGES) {
    test(`a tree with ${damage.label} is reported ${damage.verdict}`, { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
      const damaged = damagedFixture(damage);
      assert.ok(damage.port(damaged).startsWith(damage.verdict), `the row read ${damage.port(damaged)}`);
    });
  }
});

describe("the rows that drive an installer of their own", () => {
  test("an install pointed outside the named home is refused", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const portTree = { root: path.join(sandbox, "guard-port"), home: fixture().home, configHome: fixture().configHome };
    mkdirSync(portTree.root, { recursive: true });
    const port = openCodeConfigHomeGuardStatus(
      { homeDirectory: fixture().home, repositoryRoot, environment: fixtureEnvironment(fixture().home, shimmedPath(), sandbox), platform: process.platform, host: { version: undefined } },
      portTree,
    );
    assert.equal(port, "refused");
  });

  test("the row stages its own fixture install without spawning a host binary, which is what the shim on PATH would answer for", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const staged = stageOpenCodeFixture({
      homeDirectory: fixture().home,
      repositoryRoot,
      environment: fixtureEnvironment(fixture().home, shimmedPath(), sandbox),
      platform: process.platform,
      host: { version: undefined },
    });
    assert.equal(staged.kind, "ready");
    if (staged.kind === "ready") rmSync(staged.tree.root, { recursive: true, force: true });
  });

  test(
    "the staging writes the engram shim its own fixture PATH carries, so the Engram row reads present where no engram is installed",
    { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH },
    () => {
      const bare = fixtureEnvironment(fixture().home, pathWithout(ENGRAM_BINARY_NAMES), sandbox);
      assert.equal(firstExecutableOnPath(bare, ENGRAM_BINARY_NAME), undefined, "this case never controlled the PATH it claims to");
      const staged = stageOpenCodeFixture({
        homeDirectory: fixture().home,
        repositoryRoot,
        environment: bare,
        platform: process.platform,
        host: { version: undefined },
      });
      assert.equal(staged.kind, "ready");
      if (staged.kind !== "ready") return;
      try {
        assert.equal(openCodeEngramStatus(staged.tree.configHome), "present");
      } finally {
        rmSync(staged.tree.root, { recursive: true, force: true });
      }
    },
  );

  test("the shell-syntax row globs the six directories and the one named file, reaching every tracked shell source", () => {
    const sources = shellSourcesUnder(repositoryRoot).map((source) => posixSpelled(source.slice(repositoryRoot.length + 1)));
    assert.ok(sources.length > 15, `${sources.length} shell source(s) were listed`);
    assert.ok(sources.includes("bootstrap/install.sh"));
    assert.ok(sources.includes("tools/verify-check-names.sh"));
    assert.ok(sources.includes("plugin/git-hooks/pre-commit"));
  });
});

describe("treesHoldTheSameBytes cannot report exact having compared zero files", () => {
  test("two empty trees do not read exact, so an empty roster earns its own verdict rather than a vacuous match", () => {
    const published = mkdtempSync(path.join(sandbox, "tmp", "tree-empty-published-"));
    const installed = mkdtempSync(path.join(sandbox, "tmp", "tree-empty-installed-"));
    assert.equal(treesHoldTheSameBytes(published, installed), false);
  });

  test("a missing installed directory against a populated source is never exact", () => {
    const published = mkdtempSync(path.join(sandbox, "tmp", "tree-populated-"));
    writeFileSync(path.join(published, "a.txt"), "a\n");
    assert.equal(treesHoldTheSameBytes(published, path.join(published, "does-not-exist")), false);
  });

  test("two trees carrying the same file at the same relative path read exact", () => {
    const published = mkdtempSync(path.join(sandbox, "tmp", "tree-matched-published-"));
    const installed = mkdtempSync(path.join(sandbox, "tmp", "tree-matched-installed-"));
    writeFileSync(path.join(published, "a.txt"), "a\n");
    writeFileSync(path.join(installed, "a.txt"), "a\n");
    assert.equal(treesHoldTheSameBytes(published, installed), true);
  });
});

describe("verify --host opencode assembles all seventeen rows, and its own report is what names them", () => {
  test("the report names every row the table declares, in the table's order, and every fixture row passes", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const report = assembledLocalCheckReport();
    assert.deepEqual(rowNamesIn(report), OPENCODE_LOCAL_CHECK_ROWS.map((row) => row.name));
    assert.match(report, /^skip: OpenCode CLI version — opencode is not on PATH/m);
    const failedFixtureRows = failedRowNamesIn(report).filter((name) =>
      OPENCODE_LOCAL_CHECK_ROWS.some((row) => row.name === name && row.kind !== "repository"),
    );
    assert.deepEqual(failedFixtureRows, [], report);
  });

  test("a row the report emits that the table never declared is caught, not dropped", { skip: FIXTURE_SHIMS_UNREACHABLE_ON_THE_INJECTED_PATH }, () => {
    const undeclared = "a row the table never declared";
    const planted = `${assembledLocalCheckReport()}\nok:   ${undeclared} (planted)`;
    assert.ok(rowNamesIn(planted).includes(undeclared), "the reader dropped an undeclared row instead of surfacing it");
    assert.notDeepEqual(rowNamesIn(planted), OPENCODE_LOCAL_CHECK_ROWS.map((row) => row.name));
  });
});

let assembledReport: string | undefined;

function assembledLocalCheckReport(): string {
  assembledReport ??= verifyOpenCode({
    homeDirectory: fixture().home,
    repositoryRoot,
    environment: fixtureEnvironment(fixture().home, shimmedPath(), sandbox),
    platform: process.platform,
    host: { version: undefined },
  }).report;
  return assembledReport;
}

let staged: StagedFixture | undefined;

function fixture(): StagedFixture {
  staged ??= stageInstalledFixture(path.join(sandbox, "staged"));
  return staged;
}

const damagedFixtures = new Map<string, StagedFixture>();

function damagedFixture(damage: TreeDamage): StagedFixture {
  const built = damagedFixtures.get(damage.label);
  if (built !== undefined) return built;
  const relocated = relocatedFixtureHome(damagedRootOf(damage));
  damage.apply(relocated);
  damagedFixtures.set(damage.label, relocated);
  return relocated;
}

function damagedRootOf(damage: TreeDamage): string {
  return path.join(sandbox, "damaged", damage.label.replaceAll(/[^a-z0-9]+/gi, "-"));
}

function relocatedFixtureHome(destination: string): StagedFixture {
  const source = fixture();
  const home = path.join(destination, "home");
  const configHome = path.join(home, ".config", "opencode");
  mkdirSync(destination, { recursive: true });
  mkdirSync(path.join(destination, "tmp"), { recursive: true });
  cpSync(source.home, home, { recursive: true });
  const relocated: StagedFixture = {
    ...source,
    home,
    configHome,
    configFile: path.join(configHome, "opencode.json"),
    globalFile: path.join(configHome, "AGENTS.md"),
  };
  const registry = registryFileOf(relocated);
  writeFileSync(registry, readFileSync(registry, "utf8").split(source.home).join(home));
  return relocated;
}

function registryFileOf(tree: StagedFixture): string {
  return path.join(opencodePathsFor(tree.home, {}).stateRoot, "opencode-install-registry");
}

function dropRegistryRow(tree: StagedFixture, target: string): void {
  const registry = registryFileOf(tree);
  const kept = readFileSync(registry, "utf8")
    .split("\n")
    .filter((row) => !row.endsWith(`\t${target}`));
  writeFileSync(registry, kept.join("\n"));
}

function appendToFirstSharedFile(tree: StagedFixture): void {
  const shared = path.join(tree.configHome, "skill", "_shared", firstSharedFileName());
  writeFileSync(shared, `${readFileSync(shared, "utf8")}an edit the published file does not carry\n`);
}

function firstSharedFileName(): string {
  return sortedNamesIn(path.join(repositoryRoot, "plugin", "skills", "_shared")).filter((name) => name.endsWith(".md"))[0] as string;
}

function firstAgentName(): string {
  return sortedNamesIn(path.join(repositoryRoot, "opencode", "agents")).filter((name) => name.startsWith("oso-") && name.endsWith(".md"))[0] as string;
}

function withoutEngramDeny(agentContract: string): void {
  const reopened = readFileSync(agentContract, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== `${mcpServerWildcard("engram")}: deny`)
    .join("\n");
  writeFileSync(agentContract, reopened);
}

function sortedNamesIn(directory: string): string[] {
  return readdirSync(directory).sort();
}

function failedRowNamesIn(report: string): string[] {
  return report
    .split("\n")
    .flatMap((line) => {
      const failed = /^FAIL: (.*?) — expected /.exec(line);
      return failed === null ? [] : [failed[1] as string];
    });
}

function rowNamesIn(report: string): string[] {
  return report
    .split("\n")
    .flatMap((line) => {
      const passed = /^ok: {3}(.*) \([^()]*\)$/.exec(line);
      if (passed !== null) return [passed[1] as string];
      const failed = /^FAIL: (.*?) — expected /.exec(line);
      if (failed !== null) return [failed[1] as string];
      const skipped = /^skip: (.*?) —/.exec(line);
      return skipped === null ? [] : [skipped[1] as string];
    });
}

function shimmedPath(): string {
  return fixturePathWith(fixture().shims);
}


