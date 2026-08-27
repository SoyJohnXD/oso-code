import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import {
  skipUnlessSpawnable,
  STATE_SUBJECTS,
  unmeasurableSubjectsReport,
  withStateSandbox,
} from "../support/state-sandbox.ts";

type RefusedArgv = { readonly refuses: string; readonly readFrom: string; readonly argv: readonly string[] };

const HANDOFF_COORDINATES = [
  "--slice", "slice-port", "--attempt", "1",
  "--agent-id", "agent-port", "--agent-type", "oso-applier",
];

const REFUSED_ARGV: readonly RefusedArgv[] = [
  { refuses: "no argument at all", readFrom: "8c54fd8:plugin/bin/oso-state:39", argv: [] },
  { refuses: "a first word that is not --session", readFrom: "8c54fd8:plugin/bin/oso-state:39", argv: ["--sesion", "s", "show"] },
  { refuses: "a session id that sanitises to nothing", readFrom: "8c54fd8:plugin/bin/oso-state:41-42", argv: ["--session", "///", "show"] },
  { refuses: "an unknown action", readFrom: "8c54fd8:plugin/bin/oso-state:722-724", argv: ["--session", "s", "frobnicate"] },
  { refuses: "set with no key=value pair", readFrom: "8c54fd8:plugin/bin/oso-state:454", argv: ["--session", "s", "set"] },
  { refuses: "get with no key", readFrom: "8c54fd8:plugin/bin/oso-state:461", argv: ["--session", "s", "get"] },
  { refuses: "get with a second key", readFrom: "8c54fd8:plugin/bin/oso-state:461", argv: ["--session", "s", "get", "mode", "auto"] },
  { refuses: "event with no type", readFrom: "8c54fd8:plugin/bin/oso-state:474", argv: ["--session", "s", "event"] },
  { refuses: "event with a third word", readFrom: "8c54fd8:plugin/bin/oso-state:474", argv: ["--session", "s", "event", "a", "b", "c"] },
  { refuses: "journal with a second word", readFrom: "8c54fd8:plugin/bin/oso-state:478", argv: ["--session", "s", "journal", "a", "b"] },
  { refuses: "capture-plan with no digest", readFrom: "8c54fd8:plugin/bin/oso-state:495", argv: ["--session", "s", "capture-plan"] },
  { refuses: "approve-plan with a second word", readFrom: "8c54fd8:plugin/bin/oso-state:542", argv: ["--session", "s", "approve-plan", "a", "b"] },
  { refuses: "cancel-plan with no digest", readFrom: "8c54fd8:plugin/bin/oso-state:598", argv: ["--session", "s", "cancel-plan"] },
  { refuses: "amend-plan with no slice id", readFrom: "8c54fd8:plugin/bin/oso-state:633", argv: ["--session", "s", "amend-plan"] },
  { refuses: "an unknown handoff subaction", readFrom: "8c54fd8:plugin/bin/oso-state:715-720", argv: ["handoff", "inspect"] },
  { refuses: "a handoff coordinate with no value", readFrom: "8c54fd8:plugin/bin/oso-state:248", argv: ["handoff", "publish", "--slice"] },
  { refuses: "a repeated handoff coordinate", readFrom: "8c54fd8:plugin/bin/oso-state:250", argv: ["handoff", "publish", "--slice", "a", "--slice", "b"] },
  { refuses: "an unknown handoff coordinate", readFrom: "8c54fd8:plugin/bin/oso-state:256", argv: ["handoff", "publish", "--sliced", "a"] },
  { refuses: "handoff wait without a timeout", readFrom: "8c54fd8:plugin/bin/oso-state:389", argv: ["handoff", "wait", ...HANDOFF_COORDINATES] },
  { refuses: "handoff publish carrying a timeout", readFrom: "8c54fd8:plugin/bin/oso-state:339", argv: ["handoff", "publish", ...HANDOFF_COORDINATES, "--hook-session", "h", "--timeout", "5"] },
  { refuses: "handoff consume carrying a hook session", readFrom: "8c54fd8:plugin/bin/oso-state:429", argv: ["handoff", "consume", ...HANDOFF_COORDINATES, "--hook-session", "h"] },
];

provedSomething(
  `at least one of ${STATE_SUBJECTS.length} configured subject(s) is measurable here`,
  STATE_SUBJECTS.some((subject) => skipUnlessSpawnable(subject) === false),
  unmeasurableSubjectsReport(),
);

for (const subject of STATE_SUBJECTS) {
  describe(
    `${subject.name}: the argv shapes the suite never asserted — port tests read from the implementation, never parity evidence`,
    { skip: skipUnlessSpawnable(subject) },
    () => {
      for (const { refuses, readFrom, argv } of REFUSED_ARGV) {
        test(`${refuses} prints usage on stderr and exits 1 (read from ${readFrom})`, () => {
          const run = withStateSandbox("workspace", (sandbox) => sandbox.run(subject, argv));
          assert.equal(run.exit, 1, `stderr was ${JSON.stringify(run.stderr)}`);
          assert.match(run.stderr, /^usage: /);
          assert.equal(run.stdout, "");
        });
      }
    },
  );
}
