import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  COMPACT_PROMPT_KEY,
  CONFIG_MARKER_END,
  CONFIG_MARKER_START,
  GLOBAL_MARKER_END,
  GLOBAL_MARKER_START,
  MODEL_INSTRUCTIONS_KEY,
  renderCodexManagedConfig,
  tomlQuote,
} from "../../src/install/codex-config.ts";
import {
  codexPathsFor,
  installCodex,
  managedFeaturesStatus,
  purgeCodex,
  rebuildGlobalGuidance,
  repairCodex,
  type CodexCommandInput,
} from "../../src/install/codex.ts";
import { parseTomlDocument } from "../../src/install/toml.ts";
import { fixtureRepositoryRoot, pinnedHost } from "../support/codex-install-fixture.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-codex-install-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const CONFIG_TOML_CLOSURE_ROOTS = ["core/src/install/codex.ts", "core/src/install/codex-config.ts"] as const;
const NATIVE_JOIN_PATTERN = /path\.join\(|path\.resolve\(/g;
const RELATIVE_IMPORT_PATTERN = /from "(\.[^"]*)"/g;

const THE_CONFIG_TOML_CLOSURE = [
  { file: "core/src/install/backup.ts", nativeJoins: 10 },
  { file: "core/src/install/codex-config.ts", nativeJoins: 0 },
  { file: "core/src/install/codex-host.ts", nativeJoins: 2 },
  { file: "core/src/install/codex.ts", nativeJoins: 13 },
  { file: "core/src/install/json.ts", nativeJoins: 0 },
  { file: "core/src/install/pins.ts", nativeJoins: 0 },
  { file: "core/src/install/report.ts", nativeJoins: 0 },
  { file: "core/src/install/toml-regions.ts", nativeJoins: 0 },
  { file: "core/src/install/toml.ts", nativeJoins: 0 },
  { file: "core/src/install/verify-claude.ts", nativeJoins: 29 },
  { file: "core/src/state/store.ts", nativeJoins: 6 },
] as const;

const SITES_REACHING_CONFIG_TOML_BYTES = [
  {
    file: "core/src/install/codex.ts",
    producer: "codexPathsFor",
    expression: 'const codexHome = environment["CODEX_HOME"] ?? path.join(homeDirectory, ".codex");',
    carries: "the prefix the two engram pointer values below are joined onto, and nothing else since the region re-anchored on homeDirectory",
  },
  {
    file: "core/src/install/codex.ts",
    producer: "codexPathsFor",
    expression: 'runtimeRoot: path.join(homeDirectory, ".local", "share", "oso-code", "runtime"),',
    carries: "OSO_STATE_BIN",
  },
  {
    file: "core/src/install/codex.ts",
    producer: "normalizedEngramPointerConfig",
    expression: 'modelValue: path.join(paths.codexHome, "engram-instructions.md"),',
    carries: MODEL_INSTRUCTIONS_KEY,
  },
  {
    file: "core/src/install/codex.ts",
    producer: "normalizedEngramPointerConfig",
    expression: 'compactValue: path.join(paths.codexHome, "engram-compact-prompt.md"),',
    carries: COMPACT_PROMPT_KEY,
  },
  {
    file: "core/src/install/verify-claude.ts",
    producer: "firstExecutableOnPath",
    expression: "const candidate = path.join(entry, binaryName);",
    carries: "the [mcp_servers.fallow] command, verbatim through resolveFallowMcpCommand's firstOnPath branch",
  },
] as const;

let homeCounter = 0;

function fixtureHome(): string {
  homeCounter += 1;
  const home = path.join(sandbox, `home-${homeCounter}`);
  mkdirSync(path.join(home, ".codex"), { recursive: true });
  return home;
}

function inputFor(home: string, overrides: Partial<CodexCommandInput> = {}): CodexCommandInput {
  return {
    homeDirectory: home,
    repositoryRoot: fixtureRepositoryRoot(),
    environment: { PATH: "", CODEX_HOME: path.join(home, ".codex") },
    platform: "linux",
    host: pinnedHost(),
    assumeYes: true,
    installGitHook: false,
    ...overrides,
  };
}

describe("oso install --host codex over a fixture HOME", () => {
  test("without --yes it reports what it needs and touches nothing", () => {
    const home = fixtureHome();
    const outcome = installCodex(inputFor(home, { assumeYes: false }));
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.report, /requires --yes/);
    assert.equal(existsInHome(home, ".codex/config.toml"), false);
  });

  test("it writes the managed region into a fixture CODEX_HOME and reports exit 0", () => {
    const home = fixtureHome();
    const outcome = installCodex(inputFor(home));
    assert.equal(outcome.exitCode, 0, outcome.report);
    const config = readFileSync(codexPathsFor(home, inputFor(home).environment).configFile, "utf8");
    assert.ok(config.includes(`${CONFIG_MARKER_START}\n`));
    assert.ok(config.includes(`${CONFIG_MARKER_END}\n`));
    assert.equal(managedFeaturesStatus(config), "valid");
  });

  test("it preserves an operator's existing config byte for byte outside the region", () => {
    const home = fixtureHome();
    const configFile = path.join(home, ".codex", "config.toml");
    const operator = '# keep this comment\nmodel = "gpt-5"\n\n[history]\npersistence = "save-all"\n';
    writeFileSync(configFile, operator);
    assert.equal(installCodex(inputFor(home)).exitCode, 0);
    const rewritten = readFileSync(configFile, "utf8");
    assert.ok(rewritten.startsWith('# keep this comment\nmodel = "gpt-5"\n'));
    assert.ok(rewritten.includes('[history]\npersistence = "save-all"\n'));
  });

  test("it refuses an oso-owned key already living outside the region, and leaves that config unwritten", () => {
    const home = fixtureHome();
    const configFile = path.join(home, ".codex", "config.toml");
    const hostile = '[permissions.oso]\nextends = ":workspace"\n';
    writeFileSync(configFile, hostile);
    const outcome = installCodex(inputFor(home));
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.report, /oso-code-owned key permissions\.oso outside the managed region/);
    assert.equal(readFileSync(configFile, "utf8"), hostile);
  });

  test("it refuses a config with malformed markers rather than rewriting it", () => {
    const home = fixtureHome();
    const configFile = path.join(home, ".codex", "config.toml");
    const broken = `${CONFIG_MARKER_START}\nx = 1\n${CONFIG_MARKER_START}\ny = 2\n${CONFIG_MARKER_END}\n`;
    writeFileSync(configFile, broken);
    const outcome = installCodex(inputFor(home));
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.report, /malformed oso-code markers/);
    assert.equal(readFileSync(configFile, "utf8"), broken);
  });

  test("it takes a pre-install backup naming the config it is about to rewrite", () => {
    const home = fixtureHome();
    writeFileSync(path.join(home, ".codex", "config.toml"), 'model = "x"\n');
    const outcome = installCodex(inputFor(home));
    const backupLine = outcome.report.split("\n").find((line) => line.startsWith("backup: "));
    assert.ok(backupLine !== undefined, outcome.report);
    const backupRoot = backupLine.slice("backup: ".length);
    assert.equal(readFileSync(path.join(backupRoot, "items", "config"), "utf8"), 'model = "x"\n');
    assert.match(readFileSync(path.join(backupRoot, "manifest"), "utf8"), /^present\tconfig\t/m);
  });

  test("--no-git-hook is reported rather than silently skipped", () => {
    const outcome = installCodex(inputFor(fixtureHome(), { installGitHook: false }));
    assert.match(outcome.report, /skipping the git commit hook \(--no-git-hook\)/);
  });

  test("--no-impeccable is reported rather than silently skipped", () => {
    const outcome = installCodex(inputFor(fixtureHome(), { installImpeccable: false }));
    assert.match(outcome.report, /skipping impeccable \(--no-impeccable\)/);
  });

  test("it merges global AGENTS.md between its own marker pair, keeping the operator's prose", () => {
    const home = fixtureHome();
    const globalFile = path.join(home, ".codex", "AGENTS.md");
    writeFileSync(globalFile, "# my own notes\n\nkeep me\n");
    assert.equal(installCodex(inputFor(home)).exitCode, 0);
    const merged = readFileSync(globalFile, "utf8");
    assert.ok(merged.startsWith("# my own notes\n\nkeep me\n"));
    assert.ok(merged.includes(`${GLOBAL_MARKER_START}\n`) && merged.includes(`${GLOBAL_MARKER_END}\n`));
  });
});

describe("oso repair --host codex over a fixture HOME", () => {
  test("without --yes it reports what it needs", () => {
    const outcome = repairCodex(inputFor(fixtureHome(), { assumeYes: false }));
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.report, /requires --yes/);
  });

  test("it moves engram's root pointers above the managed region and says so", () => {
    const home = fixtureHome();
    const codexHome = path.join(home, ".codex");
    const configFile = path.join(codexHome, "config.toml");
    assert.equal(installCodex(inputFor(home)).exitCode, 0);
    const installed = readFileSync(configFile, "utf8");
    writeFileSync(
      configFile,
      `${installed}\nmodel_instructions_file = ${tomlQuote(path.join(codexHome, "engram-instructions.md"))}\n` +
        `experimental_compact_prompt_file = ${tomlQuote(path.join(codexHome, "engram-compact-prompt.md"))}\n`,
    );
    const outcome = repairCodex(inputFor(home));
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.match(outcome.report, /engram pointers: OK — moved above the managed region/);
    const repaired = readFileSync(configFile, "utf8");
    assert.ok(repaired.indexOf("model_instructions_file") < repaired.indexOf(CONFIG_MARKER_START));
  });

  test("the moved pointer decodes to the native engram-instructions path, and repairing it again reports already normalized, byte for byte", () => {
    const home = fixtureHome();
    const codexHome = path.join(home, ".codex");
    const configFile = path.join(codexHome, "config.toml");
    assert.equal(installCodex(inputFor(home)).exitCode, 0);
    const installed = readFileSync(configFile, "utf8");
    writeFileSync(
      configFile,
      `${installed}\nmodel_instructions_file = ${tomlQuote(path.join(codexHome, "engram-instructions.md"))}\n` +
        `experimental_compact_prompt_file = ${tomlQuote(path.join(codexHome, "engram-compact-prompt.md"))}\n`,
    );
    assert.equal(repairCodex(inputFor(home)).exitCode, 0);
    const repaired = readFileSync(configFile, "utf8");
    assert.equal(parseTomlDocument(repaired, configFile)["model_instructions_file"], path.join(codexHome, "engram-instructions.md"));

    const secondPass = repairCodex(inputFor(home));
    assert.equal(secondPass.exitCode, 0, secondPass.report);
    assert.match(secondPass.report, /engram pointers: OK — already normalized/);
    assert.equal(readFileSync(configFile, "utf8"), repaired);
  });

  test("it reports a config whose pointers are missing rather than inventing them", () => {
    const home = fixtureHome();
    assert.equal(installCodex(inputFor(home)).exitCode, 0);
    const outcome = repairCodex(inputFor(home));
    assert.match(outcome.report, /engram pointers: FAILED/);
  });
});

describe("oso purge --host codex over a fixture HOME", () => {
  test("without --yes it removes nothing", () => {
    const home = fixtureHome();
    const outcome = purgeCodex(inputFor(home, { assumeYes: false }));
    assert.equal(outcome.exitCode, 1);
    assert.equal(existsInHome(home, ".codex"), true);
  });

  test("it backs the Codex home up before removing it, and reports the restore path", () => {
    const home = fixtureHome();
    writeFileSync(path.join(home, ".codex", "config.toml"), 'model = "x"\n');
    const outcome = purgeCodex(inputFor(home));
    assert.equal(outcome.exitCode, 0, outcome.report);
    assert.equal(existsInHome(home, ".codex"), false);
    const backupRoot = (outcome.report.split("\n").find((line) => line.startsWith("backup: ")) ?? "").slice("backup: ".length);
    assert.equal(readFileSync(path.join(backupRoot, "items", "codex-home", "config.toml"), "utf8"), 'model = "x"\n');
    assert.match(outcome.report, /restore with:/);
  });

  test("an already-absent home is reported as absent rather than as a failure", () => {
    const home = fixtureHome();
    rmSync(path.join(home, ".codex"), { recursive: true, force: true });
    const outcome = purgeCodex(inputFor(home));
    assert.equal(outcome.exitCode, 0);
    assert.match(outcome.report, /Codex home: OK — already absent/);
  });
});

describe(
  `the ${SITES_REACHING_CONFIG_TOML_BYTES.length} native-join expression(s) that reach config.toml bytes, across the ` +
    `${THE_CONFIG_TOML_CLOSURE.length} file(s) of the closure that can — the row's whole win32 surface`,
  () => {
    test("the rendered body is byte-identical for the same two path strings whatever platform renders it", () => {
      const posix = renderCodexManagedConfig("/home/x/.codex", "/home/x/rt", "/usr/bin/fallow-mcp");
      const again = renderCodexManagedConfig("/home/x/.codex", "/home/x/rt", "/usr/bin/fallow-mcp");
      assert.equal(posix, again);
      assert.ok(posix.includes('OSO_STATE_BIN = "/home/x/rt/bin/oso-state"'));
    });

    test("a native win32-shaped home renders its separators back verbatim, backslash-escaped by the TOML quoter", () => {
      const rendered = renderCodexManagedConfig("C:\\Users\\x\\.codex", "C:\\Users\\x\\rt", "fallow-mcp.cmd");
      assert.ok(rendered.includes('OSO_STATE_BIN = "C:\\\\Users\\\\x\\\\rt/bin/oso-state"'));
    });

    test("the config.toml render closure is exactly the files recorded here, so no site hides in a file this walk never opens", () => {
      assert.deepEqual(
        importClosureOf(CONFIG_TOML_CLOSURE_ROOTS),
        THE_CONFIG_TOML_CLOSURE.map((entry) => entry.file),
        "the transitive relative-import closure of the config.toml renderers changed; classify the new file's native joins here",
      );
    });

    test("every closure file composes exactly the recorded number of native path.join/path.resolve expressions", () => {
      assert.deepEqual(
        THE_CONFIG_TOML_CLOSURE.map((entry) => ({ file: entry.file, nativeJoins: nativeJoinCountOf(entry.file) })),
        THE_CONFIG_TOML_CLOSURE.map((entry) => ({ file: entry.file, nativeJoins: entry.nativeJoins })),
        "a native path composition was added or removed inside the config.toml closure; record it below as reaching config.toml bytes or not, then update this count",
      );
    });

    test("every recorded site that reaches config.toml bytes still stands inside the producer named for it", () => {
      const missing = SITES_REACHING_CONFIG_TOML_BYTES.filter(
        (site) => !bodyLinesOf(sourceOf(site.file), site.producer).some((line) => line.trim() === site.expression),
      );
      assert.deepEqual(missing, [], missing.map((site) => `${site.file} ${site.producer}: ${site.expression} — carries ${site.carries}`).join("\n"));
    });
  },
);

describe("the walk this inventory rests on, read over synthetic sources this repository does not ship", () => {
  test("nativeJoinCountOf counts every occurrence rather than every line, and passes over path.posix.join", () => {
    assert.equal(countNativeJoinsIn('a = path.join(x, path.join(y, z));\nb = path.posix.join(p, q);\nc = path.resolve(r);\n'), 3);
  });

  test("bodyLinesOf returns the named function alone, and nothing for a name the source does not declare", () => {
    const source = "function first() {\n  const a = 1;\n}\n\nfunction second() {\n  const b = 2;\n}\n";
    assert.deepEqual(bodyLinesOf(source, "first"), ["function first() {", "  const a = 1;", "}"]);
    assert.deepEqual(bodyLinesOf(source, "third"), []);
  });
});

describe("the global AGENTS.md region rebuild", () => {
  test("an absent file becomes the region alone", () => {
    assert.equal(rebuildGlobalGuidance("", "body\n"), `${GLOBAL_MARKER_START}\nbody\n${GLOBAL_MARKER_END}\n`);
  });

  test("an existing region is replaced rather than duplicated", () => {
    const first = rebuildGlobalGuidance("keep\n", "one\n");
    const second = rebuildGlobalGuidance(first, "two\n");
    assert.equal(second, `keep\n\n${GLOBAL_MARKER_START}\ntwo\n${GLOBAL_MARKER_END}\n`);
    assert.equal(second.split(GLOBAL_MARKER_START).length - 1, 1);
  });

  test("a body with no trailing newline still closes on its own line", () => {
    assert.equal(rebuildGlobalGuidance("", "body"), `${GLOBAL_MARKER_START}\nbody\n${GLOBAL_MARKER_END}\n`);
  });

  test("a doubled start marker is refused rather than rebuilt", () => {
    assert.throws(() => rebuildGlobalGuidance(`${GLOBAL_MARKER_START}\n${GLOBAL_MARKER_START}\n${GLOBAL_MARKER_END}\n`, "x\n"), /malformed/);
  });
});

function existsInHome(home: string, relative: string): boolean {
  try {
    readFileSync(path.join(home, relative));
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EISDIR";
  }
}

function sourceOf(repoRelativePath: string): string {
  return readFileSync(path.join(repositoryRoot, ...repoRelativePath.split("/")), "utf8");
}

function importClosureOf(roots: readonly string[]): string[] {
  const reached = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const file = pending.shift() as string;
    if (reached.has(file)) continue;
    reached.add(file);
    for (const match of sourceOf(file).matchAll(RELATIVE_IMPORT_PATTERN)) {
      pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1] as string)));
    }
  }
  return [...reached].sort();
}

function countNativeJoinsIn(source: string): number {
  return [...source.matchAll(NATIVE_JOIN_PATTERN)].length;
}

function nativeJoinCountOf(repoRelativePath: string): number {
  return countNativeJoinsIn(sourceOf(repoRelativePath));
}

function bodyLinesOf(source: string, functionName: string): string[] {
  const lines = source.split("\n");
  const opening = lines.findIndex((line) => line.includes(`function ${functionName}(`));
  if (opening === -1) return [];
  const closing = lines.findIndex((line, index) => index > opening && line === "}");
  return lines.slice(opening, closing === -1 ? lines.length : closing + 1);
}
