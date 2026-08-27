import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pluginRootAbove, pluginRootDirectory } from "../../src/gates/preflight.ts";
import { runGate } from "../../src/gates/dispatch.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { repositoryRoot, withStateSandbox } from "../support/state-sandbox.ts";

const EXPECTED_PLUGIN_ROOT = path.join(repositoryRoot, "plugin");
const EXPECTED_STATE_BIN = path.join(EXPECTED_PLUGIN_ROOT, "bin", "oso-state");

function flatInstallFixture(prefix: string, siblings: readonly string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  mkdirSync(path.join(root, "bin"), { recursive: true });
  writeFileSync(path.join(root, "bin", "oso-state"), "");
  for (const sibling of siblings) mkdirSync(path.join(root, sibling), { recursive: true });
  return root;
}

test(
  "pluginRootAbove finds the real plugin root from the unbundled source tree " +
    "(core/src/gates/preflight.ts, no CLAUDE_PLUGIN_ROOT involved)",
  () => {
    const moduleDirectory = path.join(repositoryRoot, "core", "src", "gates");
    assert.equal(pluginRootAbove(moduleDirectory), EXPECTED_PLUGIN_ROOT);
  },
);

test(
  "pluginRootAbove finds the real plugin root from the Claude bundle location " +
    "(plugin/dist/gate.js, per docs/rewrite/ts-core-roadmap.md G2)",
  () => {
    const moduleDirectory = path.join(repositoryRoot, "plugin", "dist");
    assert.equal(pluginRootAbove(moduleDirectory), EXPECTED_PLUGIN_ROOT);
  },
);

test(
  "pluginRootAbove finds the real plugin root from the Codex bundle location " +
    "(codex/hooks/gate.js, a copy of plugin/dist per docs/rewrite/ts-core-roadmap.md:66)",
  () => {
    const moduleDirectory = path.join(repositoryRoot, "codex", "hooks");
    assert.equal(pluginRootAbove(moduleDirectory), EXPECTED_PLUGIN_ROOT);
  },
);

test(
  "the depth-three-then-literal-plugin formula this replaces lands outside the repository " +
    "for both bundle locations, never inside plugin/ (evidence for the finding this test regresses)",
  () => {
    const brokenFromDist = path.resolve(path.join(repositoryRoot, "plugin", "dist"), "..", "..", "..", "plugin");
    const brokenFromCodexHooks = path.resolve(
      path.join(repositoryRoot, "codex", "hooks"),
      "..",
      "..",
      "..",
      "plugin",
    );
    assert.notEqual(brokenFromDist, EXPECTED_PLUGIN_ROOT);
    assert.notEqual(brokenFromCodexHooks, EXPECTED_PLUGIN_ROOT);
    assert.equal(brokenFromDist, path.resolve(repositoryRoot, "..", "plugin"));
  },
);

test("pluginRootAbove fails closed when no ancestor carries a bin/oso-state, instead of guessing", () => {
  const isolated = mkdtempSync(path.join(tmpdir(), "oso-plugin-root-"));
  try {
    assert.throws(() => pluginRootAbove(isolated), /carries a bin\/oso-state, directly or one level under plugin\//);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});

test(
  "pluginRootAbove resolves the real installed Claude Code plugin cache layout — bin/, hooks/, agents/, " +
    "skills/ and git-hooks/ sit flat under the install root with no plugin/ wrapper (verified against " +
    "~/.claude/plugins/cache/oso-code/oso-code/0.25.0/, finding A)",
  () => {
    const root = flatInstallFixture("oso-claude-cache-", ["hooks", "agents", "skills", "git-hooks"]);
    try {
      assert.equal(pluginRootAbove(path.join(root, "hooks")), root);
      assert.equal(pluginRootAbove(path.join(root, "agents")), root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "pluginRootAbove resolves the real Codex staged runtime layout — hooks/, bin/ and git-hooks/ are flat " +
    "siblings under the runtime root with no plugin/ wrapper (bootstrap/install-codex.sh:514-531, finding A)",
  () => {
    const root = flatInstallFixture("oso-codex-runtime-", ["hooks", "git-hooks"]);
    try {
      assert.equal(pluginRootAbove(path.join(root, "hooks")), root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "pluginRootDirectory() falls back to the discovered plugin root when CLAUDE_PLUGIN_ROOT is unset, " +
    "isolated from this session's own ambient OSO_STATE_BIN and CLAUDE_PLUGIN_ROOT",
  () => {
    withHookEnvironment({}, () => {
      assert.equal(pluginRootDirectory(), EXPECTED_PLUGIN_ROOT);
    });
  },
);

test(
  "stale gate: with CLAUDE_PLUGIN_ROOT and OSO_STATE_BIN both unset, the remedy names the real " +
    "plugin/bin/oso-state prefix, not only its trailing --session ... clear substring " +
    "(the gap named in the finding: parity fixtures assert only the trailing substring)",
  () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ ".local/state/oso-code/{repo}.state": "mode=plan\nsession=other-session\n" });
      const stdin = sandbox.expandJson('{"session_id":"test-session","cwd":"{cwd}"}');
      const run = withHookEnvironment({ HOME: sandbox.home }, () => runGate(["stale"], stdin));
      assert.equal(run.exit, 0);
      assert.match(run.stdout, new RegExp(escapeForRegExp(EXPECTED_STATE_BIN)));
    });
  },
);

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
