import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OSO_WORKSPACE_ADAPTER,
  WORKSPACE_ADAPTER_TYPE,
  registerWorkspaceAdapter,
} from "./workspace.ts";

const HOST_BUILTIN_ADAPTER_TYPE = "worktree";

function toastSpy(): { client: unknown; messages: string[] } {
  const messages: string[] = [];
  const client = {
    tui: {
      showToast: (input: unknown) => {
        messages.push(String((input as { body?: { message?: unknown } }).body?.message ?? ""));
      },
    },
  };
  return { client, messages };
}

test("registerWorkspaceAdapter hands the host an adapter record under its own type, never the builtin", () => {
  const registeredTypes: string[] = [];
  let registeredAdapter: unknown;
  registerWorkspaceAdapter({
    experimentalWorkspace: {
      register: (type: string, adapter: unknown) => {
        registeredTypes.push(type);
        registeredAdapter = adapter;
      },
    },
  });
  assert.deepEqual(registeredTypes, [WORKSPACE_ADAPTER_TYPE]);
  assert.notEqual(WORKSPACE_ADAPTER_TYPE, HOST_BUILTIN_ADAPTER_TYPE);
  assert.equal(registeredAdapter, OSO_WORKSPACE_ADAPTER);
  assert.equal(typeof registeredAdapter, "object");
  assert.equal(OSO_WORKSPACE_ADAPTER.name, "oso-code wave");
  assert.match(OSO_WORKSPACE_ADAPTER.description, /oso_wave/);
});

test("the registered adapter refuses the host dialog by name instead of crashing on a missing method", () => {
  assert.throws(() => OSO_WORKSPACE_ADAPTER.configure(), /oso_wave/);
  assert.throws(() => OSO_WORKSPACE_ADAPTER.configure(), new RegExp(WORKSPACE_ADAPTER_TYPE));
});

test("a host carrying no workspace registry is told what is absent, never silently skipped", () => {
  for (const experimentalWorkspace of [undefined, null, {}, { register: "not a function" }]) {
    const { client, messages } = toastSpy();
    registerWorkspaceAdapter({ experimentalWorkspace, client });
    assert.equal(messages.length, 1);
    const [message] = messages;
    assert.ok(message);
    assert.match(message, new RegExp(WORKSPACE_ADAPTER_TYPE));
    assert.match(message, /adapter list/);
  }
});

test("a registry that rejects the adapter surfaces the rejection and lets the plugin finish loading", () => {
  const { client, messages } = toastSpy();
  registerWorkspaceAdapter({
    experimentalWorkspace: {
      register: () => {
        throw new Error("the registry rejected the adapter");
      },
    },
    client,
  });
  assert.deepEqual(messages, ["workspace.register: the registry rejected the adapter"]);
});
