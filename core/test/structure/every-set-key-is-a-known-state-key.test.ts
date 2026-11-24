import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SETTABLE_STATE_KEYS } from "../../src/state/known-keys.ts";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const SCANNED_PREFIXES = ["plugin/skills/", "opencode/skills/", "core/src/"];

type SetSpelling = Readonly<{ setPairs: RegExp; pairKey: RegExp }>;

const SET_SPELLINGS: readonly SetSpelling[] = [
  { setPairs: /\bset((?:[ \t]+[a-z][a-z_]*=[^\s`'"]*)+)/g, pairKey: /(?:^|[ \t])([a-z][a-z_]*)=/g },
  { setPairs: /"set"((?:,\s*"[a-z][a-z_]*=[^"]*")+)/g, pairKey: /"([a-z][a-z_]*)=/g },
];
const USAGE_PLACEHOLDER_PAIR = "key=value";

type SetWrite = Readonly<{ site: string; key: string }>;

const scannedFiles = trackedRepositoryFiles().filter((file) => SCANNED_PREFIXES.some((prefix) => file.startsWith(prefix)));

const setWrites: readonly SetWrite[] = scannedFiles.map(readTrackedText).flatMap(({ file, text }) =>
  text.split("\n").flatMap((line, index) =>
    SET_SPELLINGS.flatMap(({ setPairs, pairKey }) =>
      [...line.matchAll(setPairs)]
        .map((match) => (match[1] ?? "").trim())
        .filter((pairs) => pairs !== USAGE_PLACEHOLDER_PAIR)
        .flatMap((pairs) => [...pairs.matchAll(pairKey)].map((pair) => ({ site: `${file}:${index + 1}`, key: pair[1] ?? "" }))),
    ),
  ),
);

provedSomething(
  "a set write was found across the scanned files",
  setWrites.length > 0,
  "no set write was found, so a walk that lost a scanned tree would report no unknown key having searched nothing",
);

const knownKeys: ReadonlySet<string> = new Set(SETTABLE_STATE_KEYS);

const unknownKeyWrites = setWrites
  .filter(({ key }) => !knownKeys.has(key))
  .map(({ site, key }) => `${site}: set ${key}= is outside the allowlist`);

describe("every key a flow, a reference or a gate remedy tells oso-state to set is one set accepts", () => {
  test("no set write in authored prose, generated opencode prose or core code names a key outside the allowlist", () => {
    assert.deepEqual(unknownKeyWrites, [], unknownKeyWrites.join("\n"));
  });
});
