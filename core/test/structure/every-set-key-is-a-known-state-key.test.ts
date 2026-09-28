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

const SET_WRITES_FLOOR = 100;
const SET_WRITES_FLOOR_DERIVATION =
  "143 key writes measured when this test was written (37 active_slice, 36 mode, 36 verify_green, 13 auto, " +
  "13 roadmap, 5 auto_change, 2 auto_wait, 1 repo_path), so a walk that lost a scanned tree falls under 100";

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
  `${setWrites.length} set write(s) were found across ${scannedFiles.length} scanned file(s)`,
  setWrites.length >= SET_WRITES_FLOOR,
  `only ${setWrites.length} set write(s) were found, under the ${SET_WRITES_FLOOR}-write floor (${SET_WRITES_FLOOR_DERIVATION})`,
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
