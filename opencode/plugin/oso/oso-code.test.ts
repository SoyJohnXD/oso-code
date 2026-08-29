import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { osoCode } from "../oso-code.ts";
import { stateBinPath } from "./installed-tree.ts";
import { parseAgentVerdict } from "./verdict.ts";

type LooseHooks = Record<string, (input?: unknown, output?: unknown) => unknown>;

async function loadHooks(): Promise<LooseHooks> {
  return (await osoCode()) as unknown as LooseHooks;
}

async function hookCall(
  hooks: LooseHooks,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
): Promise<void> {
  await hooks["tool.execute.before"]!(input, output);
}

test("the module exposes exactly one named export, and osoCode resolves flat with no hooks wrapper", async () => {
  const moduleNamespace: Record<string, unknown> = await import("../oso-code.ts");
  assert.equal(Object.keys(moduleNamespace).length, 1);
  assert.equal(typeof moduleNamespace.osoCode, "function");
  const resolved = (await (moduleNamespace.osoCode as typeof osoCode)()) as unknown as LooseHooks;
  assert.equal("hooks" in resolved, false);
  assert.equal(typeof resolved["tool.execute.before"], "function");
  assert.equal(typeof resolved["shell.env"], "function");
});

test("the entry registers oso_wave as a plugin tool carrying the host's session surface", async () => {
  const opened: string[] = [];
  const hooks = (await osoCode({
    directory: process.cwd(),
    client: {
      session: {
        create: async (options: { query: { directory: string } }) => {
          opened.push(options.query.directory);
          return { data: { id: "ses-child", directory: options.query.directory } };
        },
        prompt: async () => ({ data: { parts: [{ type: "text", text: "status: done" }] } }),
        abort: async () => ({ data: true }),
      },
    },
  } as Parameters<typeof osoCode>[0])) as unknown as { tool: Record<string, { description: string; args: Record<string, unknown>; execute: (args: unknown, call: unknown) => Promise<{ output: string }> }> };

  const wave = hooks.tool?.oso_wave;
  assert.equal(typeof wave?.execute, "function");
  assert.equal(typeof wave?.description, "string");
  assert.ok("children" in (wave?.args ?? {}));

  const outside = mkdtempSync(join(tmpdir(), "oso-entry-wave-"));
  const result = await wave!.execute(
    { children: [{ worktree: outside, agent: "applier", prompt: "p" }] },
    { sessionID: "ses-root", directory: process.cwd() },
  );
  assert.deepEqual(opened, []);
  assert.match(result.output, /blocked: .*is not a git worktree/);
  rmSync(outside, { recursive: true, force: true });
});

test("the registered gate hook passes an unarmed edit call", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "oso-entry-"));
  const hooks = await loadHooks();
  await hookCall(hooks, { tool: "edit", sessionID: "ses-entry", callID: "c" }, { args: { filePath: join(cwd, "a.ts") } });
  rmSync(cwd, { recursive: true, force: true });
});

test("the registered gate hook passes an unarmed bash call", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "oso-entry-"));
  const hooks = await loadHooks();
  await hookCall(hooks, { tool: "bash", sessionID: "ses-entry", callID: "c" }, { args: { script: "echo hi" } });
  rmSync(cwd, { recursive: true, force: true });
});

test("the registered gate hook ignores a tool with no matching route", async () => {
  const hooks = await loadHooks();
  await hookCall(hooks, { tool: "read", sessionID: "ses-entry", callID: "c" }, { args: {} });
});

test("verdict parsing lives at its canonical module, not re-exported from the plugin entry", () => {
  const parsed = parseAgentVerdict("status: done\n");
  assert.equal(parsed.status, "done");
});

test("the lifecycle and identity hooks are registered and callable", async () => {
  const hooks = await loadHooks();
  for (const name of [
    "shell.env",
    "experimental.chat.system.transform",
    "experimental.session.compacting",
  ]) {
    assert.equal(typeof hooks[name], "function");
    await hooks[name]!({});
  }
});

test("shell.env publishes OSO_AGENT and OSO_STATE_BIN into the tool subprocess env", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "oso-shell-env-"));
  const hooks = await loadHooks();
  const output = (await hooks["shell.env"]!({ cwd }, { env: {} })) as { env: Record<string, string> };
  assert.equal(output.env.OSO_AGENT, "");
  assert.equal(output.env.OSO_STATE_BIN, stateBinPath());
  rmSync(cwd, { recursive: true, force: true });
});

test("shell.env preserves the host's own env entries alongside the published identity", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "oso-shell-env-"));
  const hooks = await loadHooks();
  const output = (await hooks["shell.env"]!({ cwd }, { env: { PATH: "/usr/bin" } })) as { env: Record<string, string> };
  assert.equal(output.env.PATH, "/usr/bin");
  rmSync(cwd, { recursive: true, force: true });
});

test("the event hook is registered and ignores a payload with no event", async () => {
  const hooks = await loadHooks();
  assert.equal(typeof hooks.event, "function");
  await hooks.event!(undefined);
  await hooks.event!({});
});

test("the event hook ignores an unrelated event type", async () => {
  const hooks = await loadHooks();
  await hooks.event!({ event: { type: "session.created", properties: { info: { id: "s1" } } } });
});

test("the event hook's session.idle branch tolerates a payload with no sessionID", async () => {
  const hooks = await loadHooks();
  await hooks.event!({ event: { type: "session.idle", properties: {} } });
});

test("the event hook's session.idle branch is safe to fire twice in the same turn", async () => {
  const hooks = await loadHooks();
  const event = { event: { type: "session.idle", properties: {} } };
  await hooks.event!(event);
  await hooks.event!(event);
});
