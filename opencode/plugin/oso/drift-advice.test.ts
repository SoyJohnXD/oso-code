import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { sha256Hex } from "@oso-code/core";
import entry from "../oso-code.ts";
import { fakeHostContext, type FakeHostContext } from "../../test-support/host-context.ts";
import { seedRailFixture, underRailFixtureHome, type RailFixture } from "../../test-support/rail-fixture.ts";

type DriftScene = Readonly<{
  recordedVersion: string;
  buildVersion: string;
  cliAnswer: string;
  trustedBytes: string;
  installedBytes: string;
}>;

const HARNESS_PROMPT = "you are a harness";
const TRUSTED_FILE = "plugin/dist/gate.js";
const INSTALLED_TRUSTED_FILE = join("dist", "gate.js");

const INTACT_SCENE: DriftScene = {
  recordedVersion: "0.27.0",
  buildVersion: "0.27.0",
  cliAnswer: "99.0.0",
  trustedBytes: "trusted bytes\n",
  installedBytes: "trusted bytes\n",
};

function configHomeOf(fixture: RailFixture): string {
  return join(fixture.home, ".config", "opencode");
}

function installRecordOf(fixture: RailFixture): string {
  return join(configHomeOf(fixture), "oso-code-install.json");
}

function stageScene(fixture: RailFixture, scene: DriftScene): void {
  const installed = join(configHomeOf(fixture), INSTALLED_TRUSTED_FILE);
  mkdirSync(dirname(installed), { recursive: true });
  writeFileSync(installed, scene.installedBytes);
  const record = {
    version: scene.recordedVersion,
    manifest: [{ digest: sha256Hex(Buffer.from(scene.trustedBytes)), file: TRUSTED_FILE }],
  };
  writeFileSync(installRecordOf(fixture), `${JSON.stringify(record, null, 2)}\n`);
  writeFakeOpenCode(fixture, scene.cliAnswer);
}

function writeFakeOpenCode(fixture: RailFixture, answer: string): void {
  const binary = join(fakeBinDirectoryOf(fixture), "opencode");
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' '${answer}'\n`);
  chmodSync(binary, 0o700);
}

function fakeBinDirectoryOf(fixture: RailFixture): string {
  return join(fixture.base, "fake-bin");
}

async function underDriftEnvironment<T>(fixture: RailFixture, buildVersion: string, run: () => Promise<T>): Promise<T> {
  const pinned = {
    XDG_CONFIG_HOME: join(fixture.home, ".config"),
    PATH: `${fakeBinDirectoryOf(fixture)}:${process.env.PATH ?? ""}`,
    OSO_HARNESS_BUILD_VERSION: buildVersion,
  };
  const restored = Object.keys(pinned).map((name) => [name, process.env[name]] as const);
  Object.assign(process.env, pinned);
  try {
    return await underRailFixtureHome(fixture, run);
  } finally {
    for (const [name, value] of restored) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function systemPromptAfter(fixture: RailFixture, host: FakeHostContext, sessionID: string, buildVersion: string): Promise<string[]> {
  const output = { sessionID, system: [{ type: "text", text: HARNESS_PROMPT }] };
  await underDriftEnvironment(fixture, buildVersion, () => host.hook("session", "context")(output));
  return output.system.map((part) => part.text);
}

async function sessionIdle(fixture: RailFixture, host: FakeHostContext, sessionID: string, buildVersion: string): Promise<void> {
  await underDriftEnvironment(fixture, buildVersion, () => host.hook("session", "experimental.idle")({ sessionID, background: [] }));
}

function tracedEvents(fixture: RailFixture): string {
  const eventsLog = join(fixture.home, ".local", "state", "oso-code", "events.jsonl");
  return existsSync(eventsLog) ? readFileSync(eventsLog, "utf8") : "";
}

async function withScene(label: string, scene: DriftScene | undefined, check: (fixture: RailFixture, host: FakeHostContext) => Promise<void>): Promise<void> {
  const fixture = seedRailFixture(label);
  try {
    if (scene !== undefined) stageScene(fixture, scene);
    const host = fakeHostContext({ directory: fixture.repo, defaultSessionDirectory: fixture.repo });
    await entry.setup(host.context);
    await check(fixture, host);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

test("an install record whose version differs from the running build tells the session once, naming both and the reinstall", async () => {
  const scene = { ...INTACT_SCENE, recordedVersion: "0.26.4", buildVersion: "0.27.0" };
  await withScene("oso-drift-version", scene, async (fixture, host) => {
    const system = await systemPromptAfter(fixture, host, "ses-drift-version", scene.buildVersion);
    assert.equal(system.length, 2, system.join("\n"));
    assert.match(system[1]!, /0\.26\.4/);
    assert.match(system[1]!, /0\.27\.0/);
    assert.match(system[1]!, /oso install --host opencode/);
  });
});

test("a trusted installed file whose digest left the recorded manifest names the file and the verify and reinstall remedy", async () => {
  const scene = { ...INTACT_SCENE, installedBytes: "tampered bytes\n" };
  await withScene("oso-drift-files", scene, async (fixture, host) => {
    const system = await systemPromptAfter(fixture, host, "ses-drift-files", scene.buildVersion);
    assert.equal(system.length, 2, system.join("\n"));
    assert.match(system[1]!, /plugin\/dist\/gate\.js/);
    assert.match(system[1]!, /oso verify --host opencode/);
    assert.match(system[1]!, /oso install --host opencode/);
  });
});

test("an OpenCode CLI older than the supported pin tells the session once", async () => {
  const scene = { ...INTACT_SCENE, cliAnswer: "1.0.0" };
  await withScene("oso-drift-cli", scene, async (fixture, host) => {
    const system = await systemPromptAfter(fixture, host, "ses-drift-cli", scene.buildVersion);
    assert.equal(system.length, 2, system.join("\n"));
    assert.match(system[1]!, /OpenCode 1\.0\.0/);
    assert.match(system[1]!, /older than/);
  });
});

test("a newer CLI and an intact install at the running build's version say nothing", async () => {
  await withScene("oso-drift-intact", INTACT_SCENE, async (fixture, host) => {
    assert.deepEqual(await systemPromptAfter(fixture, host, "ses-drift-intact", INTACT_SCENE.buildVersion), [HARNESS_PROMPT]);
  });
});

test("the drift advice rides the session's first turn only, never a later prompt", async () => {
  const scene = { ...INTACT_SCENE, recordedVersion: "0.26.4" };
  await withScene("oso-drift-once", scene, async (fixture, host) => {
    const first = await systemPromptAfter(fixture, host, "ses-drift-once", scene.buildVersion);
    assert.equal(first.length, 2, first.join("\n"));
    await sessionIdle(fixture, host, "ses-drift-once", scene.buildVersion);
    assert.deepEqual(await systemPromptAfter(fixture, host, "ses-drift-once", scene.buildVersion), [HARNESS_PROMPT]);
  });
});

test("a missing install record gives no advice and leaves a trace", async () => {
  await withScene("oso-drift-no-record", undefined, async (fixture, host) => {
    writeFakeOpenCode(fixture, "1.0.0");
    assert.deepEqual(await systemPromptAfter(fixture, host, "ses-drift-no-record", INTACT_SCENE.buildVersion), [HARNESS_PROMPT]);
    assert.match(tracedEvents(fixture), /opencode-install-record-unread/);
  });
});

test("an unparseable install record gives no advice and leaves a trace carrying the parse failure", async () => {
  await withScene("oso-drift-bad-record", INTACT_SCENE, async (fixture, host) => {
    writeFileSync(installRecordOf(fixture), "{ not json\n");
    assert.deepEqual(await systemPromptAfter(fixture, host, "ses-drift-bad-record", INTACT_SCENE.buildVersion), [HARNESS_PROMPT]);
    assert.match(tracedEvents(fixture), /opencode-install-record-unread/);
    assert.match(tracedEvents(fixture), /cannot parse JSON/);
  });
});

test("a CLI probe that answers no version gives no advice and leaves a trace", async () => {
  const scene = { ...INTACT_SCENE, cliAnswer: "not a version" };
  await withScene("oso-drift-bad-probe", scene, async (fixture, host) => {
    assert.deepEqual(await systemPromptAfter(fixture, host, "ses-drift-bad-probe", scene.buildVersion), [HARNESS_PROMPT]);
    assert.match(tracedEvents(fixture), /opencode-cli-unprobed/);
  });
});
