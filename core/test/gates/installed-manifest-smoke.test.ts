import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { manifestPathOf } from "../../src/routes/render.ts";
import {
  commitEnvelopeFor,
  spawnAsHookHost,
  type HookCommandLine,
  type SpawnedRun,
} from "../support/hook-invocation.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot, STATE_FILE, withStateSandbox, type StateSandbox } from "../support/state-sandbox.ts";

const CLAUDE_PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}";
const INSTALLED_PLUGIN = path.join(".claude", "plugins", "oso-code");
const SESSION = "test-session";
const COMMIT_ENVELOPE = commitEnvelopeFor(SESSION);

const commitHandler = handlerForGate("commit");

provedSomething(
  `${manifestPathOf("claude")} carries a PreToolUse handler for the commit gate`,
  commitHandler !== undefined,
  `${manifestPathOf("claude")} named no commit handler, so this smoke ran nothing the host would run`,
);

describe(
  `the command line ${manifestPathOf("claude")} publishes runs the installed bundle on this platform`,
  () => {
    test("an armed repository whose verify is red denies the commit through the manifest's own command line", () => {
      const run = withStateSandbox("workspace", (sandbox) => {
        sandbox.seed({ [STATE_FILE]: `mode=plan\nactive_slice=none\nverify_green=false\nsession=${SESSION}\n` });
        return runInstalledHandler(sandbox);
      });
      assert.equal(run.status, 0, `the installed handler failed: ${run.stderr}`);
      assert.match(run.stdout, /"permissionDecision":"deny"/);
    });

    test("a repository with no state file is left untouched by the same command line", () => {
      const run = withStateSandbox("workspace", (sandbox) => runInstalledHandler(sandbox));
      assert.equal(run.status, 0, `the installed handler failed: ${run.stderr}`);
      assert.equal(run.stdout, "");
      assert.equal(run.stderr, "");
    });
  },
);

function runInstalledHandler(sandbox: StateSandbox): SpawnedRun {
  if (commitHandler === undefined) throw new Error("the commit handler guard above should have failed first");
  const pluginRoot = installPluginUnder(sandbox);
  return spawnAsHookHost(
    sandbox,
    {
      command: commitHandler.command,
      args: commitHandler.args.map((argument) => argument.replaceAll(CLAUDE_PLUGIN_ROOT, pluginRoot)),
    },
    COMMIT_ENVELOPE,
  );
}

function installPluginUnder(sandbox: StateSandbox): string {
  const pluginRoot = path.join(sandbox.home, INSTALLED_PLUGIN);
  mkdirSync(path.join(pluginRoot, "hooks"), { recursive: true });
  cpSync(path.join(repositoryRoot, "plugin", "dist"), path.join(pluginRoot, "dist"), { recursive: true });
  cpSync(
    path.join(repositoryRoot, manifestPathOf("claude")),
    path.join(pluginRoot, "hooks", "hooks.json"),
  );
  return pluginRoot;
}

function handlerForGate(gate: string): HookCommandLine | undefined {
  const document: unknown = JSON.parse(readFileSync(path.join(repositoryRoot, manifestPathOf("claude")), "utf8"));
  const groups = (document as { hooks?: Record<string, unknown[]> }).hooks?.["PreToolUse"] ?? [];
  const handlers = groups.flatMap((group) => (group as { hooks?: HookCommandLine[] }).hooks ?? []);
  return handlers.find((handler) => handler.args?.includes(gate));
}
