import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { runGate } from "../../src/gates/dispatch.ts";
import { logEvent } from "../../src/state/store.ts";
import type { ObservedRun } from "./parity-expectations.ts";
import type { FixtureExpectation, SuiteCitation } from "./parity-fixture.ts";
import { repositoryRoot, type SeededEntry, type StateSandbox } from "./state-sandbox.ts";

export const GATE_FIXTURE_DIRECTORY = path.join(repositoryRoot, "core", "test", "fixtures", "gates");

export type GateFixture = {
  name: string;
  source: readonly SuiteCitation[];
  gate: string;
  argv: readonly string[];
  env: Readonly<Record<string, string>>;
  state_before: Readonly<Record<string, SeededEntry>>;
  cwd: string;
  stdin: string;
  expect: FixtureExpectation;
};

export function loadGateFixtures(): GateFixture[] {
  return readdirSync(GATE_FIXTURE_DIRECTORY)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => readGateFixture(path.join(GATE_FIXTURE_DIRECTORY, entry)));
}

export function observeGate(sandbox: StateSandbox, fixture: GateFixture): ObservedRun {
  const eventsBefore = sandbox.eventLogLines().length;
  const run = withHookEnvironment({ HOME: sandbox.home, ...fixture.env }, () => {
    const gateRun = runGate([fixture.gate, ...fixture.argv], sandbox.expandJson(fixture.stdin));
    for (const event of gateRun.events) logEvent(event);
    return gateRun;
  });
  return {
    exit: run.exit,
    stdout: run.stdout,
    stderr: run.stderr,
    entries: new Map(),
    eventsAppended: sandbox.eventLogLines().slice(eventsBefore),
  };
}

const HOST_MARKERS_A_FIXTURE_OWNS = { OSO_AGENT: "", OSO_HOST: "" };

export function withHookEnvironment<T>(pinned: Readonly<Record<string, string>>, run: () => T): T {
  const restored = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries({ ...HOST_MARKERS_A_FIXTURE_OWNS, ...pinned })) {
    restored.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    return run();
  } finally {
    for (const [name, value] of restored) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function readGateFixture(file: string): GateFixture {
  const document: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof document !== "object" || document === null) throw new Error(`${file} is not a fixture object`);
  const fixture = document as GateFixture;
  if (typeof fixture.name !== "string" || fixture.name === "") throw new Error(`${file} carries no fixture name`);
  if (!Array.isArray(fixture.source) || fixture.source.length === 0) {
    throw new Error(`${fixture.name} carries no source citation, so it is not parity evidence`);
  }
  if (typeof fixture.gate !== "string" || fixture.gate === "") throw new Error(`${fixture.name} names no gate`);
  if (typeof fixture.stdin !== "string") throw new Error(`${fixture.name} carries no envelope on stdin`);
  if (typeof fixture.expect !== "object" || fixture.expect === null) {
    throw new Error(`${fixture.name} carries no expectation`);
  }
  return fixture;
}
