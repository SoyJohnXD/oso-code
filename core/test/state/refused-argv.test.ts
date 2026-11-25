import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  provedTheStateSubjectIsMeasurable,
  skipUnlessSpawnable,
  STATE_SUBJECT,
  withStateSandbox,
} from "../support/state-sandbox.ts";

type RefusedArgv = { readonly refuses: string; readonly argv: readonly string[] };

const REFUSED_ARGV: readonly RefusedArgv[] = [
  { refuses: "no argument at all", argv: [] },
  { refuses: "a first word that is not --session", argv: ["--sesion", "s", "show"] },
  { refuses: "a session id that sanitises to nothing", argv: ["--session", "///", "show"] },
  { refuses: "an unknown action", argv: ["--session", "s", "frobnicate"] },
  { refuses: "set with no key=value pair", argv: ["--session", "s", "set"] },
  { refuses: "get with no key", argv: ["--session", "s", "get"] },
  { refuses: "get with a second key", argv: ["--session", "s", "get", "mode", "auto"] },
  { refuses: "event with no type", argv: ["--session", "s", "event"] },
  { refuses: "event with a third word", argv: ["--session", "s", "event", "a", "b", "c"] },
  { refuses: "journal with a second word", argv: ["--session", "s", "journal", "a", "b"] },
  { refuses: "capture-plan with no digest", argv: ["--session", "s", "capture-plan"] },
  { refuses: "approve-plan with a second word", argv: ["--session", "s", "approve-plan", "a", "b"] },
  { refuses: "cancel-plan with no digest", argv: ["--session", "s", "cancel-plan"] },
  { refuses: "amend-plan with no slice id", argv: ["--session", "s", "amend-plan"] },
];

provedTheStateSubjectIsMeasurable();

describe(
  `${STATE_SUBJECT.name}: the argv shapes it refuses`,
  { skip: skipUnlessSpawnable(STATE_SUBJECT) },
  () => {
    for (const { refuses, argv } of REFUSED_ARGV) {
      test(`${refuses} prints usage on stderr and exits 1`, () => {
        const run = withStateSandbox("workspace", (sandbox) => sandbox.run(STATE_SUBJECT, argv));
        assert.equal(run.exit, 1, `stderr was ${JSON.stringify(run.stderr)}`);
        assert.match(run.stderr, /^usage: /);
        assert.equal(run.stdout, "");
      });
    }
  },
);
