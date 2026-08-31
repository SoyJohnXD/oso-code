import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { versionFieldOf } from "../../src/install/opencode-host.ts";
import {
  configFileRefusal,
  configHomeRefusal,
  globalFileRefusal,
  GLOBAL_MARKER_END,
  GLOBAL_MARKER_START,
  keysRecordedButMissing,
  mergeGlobalAgents,
  opencodePathsFor,
  renderGlobalAgents,
  restoreBlockedBy,
  withRestoredKeys,
  withoutOpenCodeMarkerRegion,
} from "../../src/install/opencode.ts";
import type { ConfigDocument } from "../../src/install/opencode-config.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-opencode-unit-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const BLOCK_BODY = "the shipped body\n";

describe("opencodePathsFor: initialize_paths, read from a home and an environment rather than from a sourced script", () => {
  test("derives the config home from XDG_CONFIG_HOME when it is set, and from HOME/.config when it is not", () => {
    const fromHome = opencodePathsFor("/home/operator", {});
    assert.equal(fromHome.configHome, path.join("/home/operator", ".config", "opencode"));
    assert.equal(fromHome.configFile, path.join("/home/operator", ".config", "opencode", "opencode.json"));
    assert.equal(fromHome.globalFile, path.join("/home/operator", ".config", "opencode", "AGENTS.md"));
    const fromXdg = opencodePathsFor("/home/operator", { XDG_CONFIG_HOME: "/elsewhere" });
    assert.equal(fromXdg.configHome, path.join("/elsewhere", "opencode"));
  });

  test("anchors the backups root on HOME alone, never on the config home an operator may move", () => {
    const paths = opencodePathsFor("/home/operator", { XDG_CONFIG_HOME: "/elsewhere" });
    assert.equal(paths.backupsRoot, path.join("/home/operator", ".local", "state", "oso-code"));
    assert.equal(paths.stateRoot, paths.backupsRoot);
  });
});

describe("the config-home preflight, which is the one refusal that exits 2 rather than 1", () => {
  test("accepts an unset XDG_CONFIG_HOME and the default one, and refuses any other, naming the verb", () => {
    assert.equal(configHomeRefusal("/home/operator", {}, "repair"), undefined);
    assert.equal(configHomeRefusal("/home/operator", { XDG_CONFIG_HOME: "" }, "repair"), undefined);
    assert.equal(configHomeRefusal("/home/operator", { XDG_CONFIG_HOME: path.join("/home/operator", ".config") }, "install"), undefined);
    const refusal = configHomeRefusal("/home/operator", { XDG_CONFIG_HOME: "/decoy" }, "repair");
    assert.equal(refusal?.kind, "usage");
    assert.match(refusal?.message ?? "", /so this repair would write outside the home it was pointed at/);
    assert.match(configHomeRefusal("/home/operator", { XDG_CONFIG_HOME: "/decoy" }, "install")?.message ?? "", /so this install would/);
  });
});

describe("the config and global-guidance preflights", () => {
  test("a config that is not a regular file is refused before it is read", () => {
    const workspace = workspaceFor("not-a-file");
    const configFile = path.join(workspace, "opencode.json");
    mkdirSync(configFile);
    assert.match(configFileRefusal(configFile)?.message ?? "", /OpenCode config is not a regular file/);
  });

  test("a config that is not JSON is refused with the words that tell an operator what to do next", () => {
    const configFile = fileIn("bad-json", "opencode.json", "{ not json");
    assert.match(configFileRefusal(configFile)?.message ?? "", /is not valid JSON: .* \(back it up and fix it, then re-run\)/);
  });

  test("an absent config and a valid one are both accepted", () => {
    assert.equal(configFileRefusal(path.join(workspaceFor("absent"), "opencode.json")), undefined);
    assert.equal(configFileRefusal(fileIn("valid", "opencode.json", '{"theme":"x"}')), undefined);
  });

  test("a global guidance file with malformed markers is refused, and a well-formed or absent one is not", () => {
    const malformed = fileIn("malformed", "AGENTS.md", `${GLOBAL_MARKER_END}\nstray\n`);
    assert.match(globalFileRefusal(malformed)?.message ?? "", /malformed oso-code markers/);
    assert.equal(globalFileRefusal(fileIn("well-formed", "AGENTS.md", `${GLOBAL_MARKER_START}\nbody\n${GLOBAL_MARKER_END}\n`)), undefined);
    assert.equal(globalFileRefusal(path.join(workspaceFor("no-global"), "AGENTS.md")), undefined);
  });
});

describe("withoutOpenCodeMarkerRegion: strip_managed_region's four refusals and its one clean answer", () => {
  test("keeps everything outside a single well-formed region", () => {
    const stripped = withoutOpenCodeMarkerRegion(`before\n${GLOBAL_MARKER_START}\nowned\n${GLOBAL_MARKER_END}\nafter\n`);
    assert.deepEqual(stripped, { kind: "clean", text: "before\nafter\n" });
  });

  test("refuses a nested start, an end before a start, an unclosed region and a second region", () => {
    for (const content of [
      `${GLOBAL_MARKER_START}\n${GLOBAL_MARKER_START}\n${GLOBAL_MARKER_END}\n`,
      `${GLOBAL_MARKER_END}\n`,
      `${GLOBAL_MARKER_START}\nowned\n`,
      `${GLOBAL_MARKER_START}\na\n${GLOBAL_MARKER_END}\n${GLOBAL_MARKER_START}\nb\n${GLOBAL_MARKER_END}\n`,
    ]) {
      assert.deepEqual(withoutOpenCodeMarkerRegion(content), { kind: "malformed" }, content);
    }
  });

  test("a CRLF marker line is content rather than a marker, which is where this host parts from the CLAUDE.md row", () => {
    const stripped = withoutOpenCodeMarkerRegion(`${GLOBAL_MARKER_START}\r\nowned\r\n${GLOBAL_MARKER_END}\r\n`);
    assert.equal(stripped.kind, "clean");
    assert.equal(stripped.kind === "clean" ? stripped.text.includes("oso-code:start") : false, true);
  });
});

describe("merge_global_agents: the trailing-blank trim, the blank separator, and the fresh region at the end", () => {
  test("trims trailing blank lines from the operator's prose and separates it from the region with one blank line", () => {
    assert.equal(renderGlobalAgents("prose\n\n  \n", BLOCK_BODY), `prose\n\n${GLOBAL_MARKER_START}\n${BLOCK_BODY}${GLOBAL_MARKER_END}\n`);
  });

  test("writes no separator when there is no operator prose at all", () => {
    assert.equal(renderGlobalAgents("", BLOCK_BODY), `${GLOBAL_MARKER_START}\n${BLOCK_BODY}${GLOBAL_MARKER_END}\n`);
  });

  test("a file of blank lines alone keeps the separator the bash's -s test keeps, with nothing above it", () => {
    assert.equal(renderGlobalAgents("\n\n", BLOCK_BODY), `\n${GLOBAL_MARKER_START}\n${BLOCK_BODY}${GLOBAL_MARKER_END}\n`);
  });

  test("merging twice over the same file is idempotent, and the operator's prose keeps its order", () => {
    const globalFile = fileIn("merge", "AGENTS.md", "# operator rules\n\nprose\n");
    mergeGlobalAgents(globalFile, BLOCK_BODY);
    const once = readFileSync(globalFile, "utf8");
    mergeGlobalAgents(globalFile, BLOCK_BODY);
    assert.equal(readFileSync(globalFile, "utf8"), once);
    assert.match(once, /^# operator rules\n\nprose\n\n<!-- oso-code:start -->\n/);
  });

  test("merging into a file with malformed markers throws rather than appending a second region", () => {
    const globalFile = fileIn("merge-malformed", "AGENTS.md", `${GLOBAL_MARKER_END}\nstray\n`);
    assert.throws(() => mergeGlobalAgents(globalFile, BLOCK_BODY), /malformed oso-code markers/);
    assert.equal(readFileSync(globalFile, "utf8"), `${GLOBAL_MARKER_END}\nstray\n`);
  });

  test("merging where no file exists yet writes one carrying the region alone", () => {
    const globalFile = path.join(workspaceFor("merge-fresh"), "AGENTS.md");
    mergeGlobalAgents(globalFile, BLOCK_BODY);
    assert.equal(readFileSync(globalFile, "utf8"), `${GLOBAL_MARKER_START}\n${BLOCK_BODY}${GLOBAL_MARKER_END}\n`);
  });
});

describe("keysRecordedButMissing: the four nested paths repair reads, and the containers it never restores as keys", () => {
  const recorded: ConfigDocument = {
    theme: "operator",
    permission: { read: "allow", skill: { mine: "allow" }, task: { "mine-*": "deny" } },
    mcp: { mine: { command: ["x"] } },
  };

  test("names a top-level key, a permission key, a skill mode, a task pattern and an mcp server, in that order", () => {
    const missing = keysRecordedButMissing(recorded, {});
    assert.deepEqual(missing.map((key) => key.keyPath), ["theme", "permission.read", "permission.skill.mine", "permission.task.mine-*", "mcp.mine"]);
  });

  test("never names permission, mcp, permission.skill or permission.task themselves, since those are containers", () => {
    const named = keysRecordedButMissing(recorded, {}).map((key) => key.keyPath);
    for (const container of ["permission", "mcp", "permission.skill", "permission.task"]) assert.equal(named.includes(container), false);
  });

  test("names nothing when the live config already holds every recorded key", () => {
    assert.deepEqual(keysRecordedButMissing(recorded, JSON.parse(JSON.stringify(recorded)) as ConfigDocument), []);
  });

  test("restoring appends each key to its own container, leaving what is already there in place", () => {
    const live: ConfigDocument = { permission: { write: "deny" } };
    const restored = withRestoredKeys(live, keysRecordedButMissing(recorded, live));
    assert.deepEqual(restored["permission"], { write: "deny", read: "allow", skill: { mine: "allow" }, task: { "mine-*": "deny" } });
    assert.deepEqual(restored["mcp"], { mine: { command: ["x"] } });
  });
});

describe("restoreBlockedBy: the one place this port refuses where the bash would crash mid-write", () => {
  test("names the key whose container in the live config is a value rather than an object", () => {
    const live: ConfigDocument = { permission: { skill: "not an object" } };
    const blocked = restoreBlockedBy(live, keysRecordedButMissing({ permission: { skill: { mine: "allow" } } }, live));
    assert.equal(blocked, "permission.skill.mine");
  });

  test("blocks nothing when every container is absent or already an object", () => {
    assert.equal(restoreBlockedBy({}, [{ keyPath: "permission.skill.mine", value: "allow" }]), undefined);
    assert.equal(restoreBlockedBy({ permission: { skill: {} } }, [{ keyPath: "permission.skill.mine", value: "allow" }]), undefined);
  });
});

describe("versionFieldOf: opencode_version_of's sed and tr, with no shell in the way", () => {
  test("strips ANSI colour and every POSIX space, leaving the version alone", () => {
    assert.equal(versionFieldOf("[32m 1.18.22 [0m\n"), "1.18.22");
    assert.equal(versionFieldOf("opencode\t1.18.22\r\n"), "opencode1.18.22");
  });

  test("leaves a bracket that is not an escape sequence where it is", () => {
    assert.equal(versionFieldOf("[not-an-escape]1.0.0\n"), "[not-an-escape]1.0.0");
  });
});

describe("a config home reached through a symlink is still refused by the regular-file preflight", () => {
  test("a symlinked opencode.json is not a regular non-symlink file, so the preflight refuses it", () => {
    const workspace = workspaceFor("symlinked");
    const real = path.join(workspace, "real.json");
    writeFileSync(real, '{"theme":"x"}');
    const link = path.join(workspace, "opencode.json");
    symlinkSync(real, link);
    assert.match(configFileRefusal(link)?.message ?? "", /OpenCode config is not a regular file/);
  });
});

function workspaceFor(label: string): string {
  const workspace = path.join(sandbox, label);
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

function fileIn(label: string, name: string, content: string): string {
  const file = path.join(workspaceFor(label), name);
  writeFileSync(file, content);
  return file;
}
