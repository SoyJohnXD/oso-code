import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { lexShellCommands, SHELL_WORDS_THIS_LEXER_READS, type LexRecord } from "../../src/shell/lexer.ts";
import {
  CONSTRUCTS_EXCLUDED_BY_CONSTRUCTION,
  CONSTRUCTS_THE_CORPUS_EXERCISES,
  exercisedConstructsNoProbeSpells,
  probesCarryingAnExcludedConstruct,
  shellWordsInNoStanding,
} from "../support/shell-constructs.ts";
import {
  LEXER_DIFFERENTIAL_FIXTURE,
  lexerDifferentialFromTheRealShell,
  THE_ORACLE,
  type LexerDifferential,
  type ObservedArgvProbe,
} from "../support/lexer-differential.ts";
import { shellSpawnsForTracing } from "../support/shell-xtrace.ts";
import { provedSomething } from "../support/proved.ts";

const MINIMUM_ARGV_PROBES = 300;
const MINIMUM_EQUIVALENCE_PAIRS = 100;
const NIGHTLY = process.env["OSO_NIGHTLY"] === "1";

const differential = JSON.parse(readFileSync(LEXER_DIFFERENTIAL_FIXTURE, "utf8")) as LexerDifferential;
const constructs = [...new Set(differential.argvProbes.map((probe) => probe.construct))];

provedSomething(
  `${differential.argvProbes.length} argv probe(s) across ${constructs.length} construct class(es) and ` +
    `${differential.equivalences.length} equivalence pair(s) were read from ${THE_ORACLE}`,
  differential.argvProbes.length >= MINIMUM_ARGV_PROBES &&
    differential.equivalences.length >= MINIMUM_EQUIVALENCE_PAIRS &&
    differential.oracle === THE_ORACLE,
  `the committed corpus holds ${differential.argvProbes.length} argv probe(s) and ` +
    `${differential.equivalences.length} equivalence pair(s) against a floor of ` +
    `${MINIMUM_ARGV_PROBES} and ${MINIMUM_EQUIVALENCE_PAIRS}, so a clean result would prove little`,
);

describe(`core/src/shell/lexer.ts against ${THE_ORACLE}, replayed from the committed corpus`, () => {
  for (const construct of constructs) {
    const probes = differential.argvProbes.filter((probe) => probe.construct === construct);
    test(`${probes.length} probe(s) of ${construct} lex into the words the shell hands the command`, () => {
      assert.deepEqual(probes.filter(readsDifferentlyFromTheShell).map(mismatchOf), []);
    });
  }

  test(`${differential.equivalences.length} escape(s) lex the same as the character they stand for`, () => {
    assert.deepEqual(
      differential.equivalences
        .filter((pair) => rendered(pair.escaped) !== rendered(pair.literal))
        .map((pair) => `${pair.escaped} lexes as ${rendered(pair.escaped)}, ${pair.literal} as ${rendered(pair.literal)}`),
      [],
    );
  });
});

describe("the corpus states what it leaves out, and holds itself to it", () => {
  test(`all ${CONSTRUCTS_EXCLUDED_BY_CONSTRUCTION.length} excluded constructs are recorded beside the corpus`, () => {
    assert.deepEqual(differential.excluded, CONSTRUCTS_EXCLUDED_BY_CONSTRUCTION.map((construct) => construct.named));
  });

  test("no probe line spells a construct the corpus excludes by construction", () => {
    assert.deepEqual(probesCarryingAnExcludedConstruct(everyProbeLine()), []);
  });

  test(`each of the ${CONSTRUCTS_THE_CORPUS_EXERCISES.length} constructs it claims to exercise is spelled by a probe`, () => {
    assert.deepEqual(exercisedConstructsNoProbeSpells(everyProbeLine()), []);
  });

  test(`every one of the ${everyWordTheShellKnows().length} words the shell reads specially is answered by this lexer`, () => {
    assert.deepEqual(shellWordsInNoStanding(everyWordTheShellKnows(), SHELL_WORDS_THIS_LEXER_READS), []);
  });
});

describe("the committed corpus against the shell of the day, which nightly re-runs", () => {
  test("every recorded argv and every recorded equivalence still reads that way", { skip: skipUnlessNightly() }, () => {
    assert.deepEqual(lexerDifferentialFromTheRealShell(), differential);
  });
});

function skipUnlessNightly(): false | string {
  if (!NIGHTLY) return "the PR gate replays the committed corpus; the real shell is nightly's, under OSO_NIGHTLY=1";
  if (!shellSpawnsForTracing()) return "bash cannot be spawned here, so the oracle cannot be re-read";
  return false;
}

function everyWordTheShellKnows(): readonly string[] {
  return [...differential.vocabulary.reservedWords, ...differential.vocabulary.builtins];
}

function everyProbeLine(): readonly string[] {
  return [
    ...differential.argvProbes.map((probe) => probe.line),
    ...differential.equivalences.flatMap((pair) => [pair.escaped, pair.literal]),
  ];
}

function readsDifferentlyFromTheShell(probe: ObservedArgvProbe): boolean {
  return rendered(probe.line) !== recordsOfTracedCommands(probe.commands);
}

function mismatchOf(probe: ObservedArgvProbe): string {
  return `${probe.line} lexes as ${rendered(probe.line)}, the shell runs ${recordsOfTracedCommands(probe.commands)}`;
}

function recordsOfTracedCommands(commands: readonly (readonly string[])[]): string {
  return commands
    .flatMap((argv) => argv.map((word, index) => `${index === 0 ? ">" : "."}${word}`))
    .join(" ");
}

function rendered(line: string): string {
  return lexShellCommands(line).map(renderedRecord).join(" ");
}

function renderedRecord(record: LexRecord): string {
  switch (record.kind) {
    case "commandWord":
      return `>${record.word}`;
    case "argument":
      return `.${record.word}`;
    case "stdinText":
      return `<${record.text}`;
    case "unreadPayload":
      return "!unread-payload";
  }
}
