import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { JsonParseError, readJsonFile, readJsonObject, writeJsonFile } from "../../src/install/json.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-json-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

describe("readJsonFile", () => {
  test("returns undefined for a file that is not there", () => {
    assert.equal(readJsonFile(path.join(sandbox, "absent.json")), undefined);
  });

  test("parses a present file's JSON value", () => {
    const file = path.join(sandbox, "present.json");
    writeJsonFile(file, { a: 1 });
    assert.deepEqual(readJsonFile(file), { a: 1 });
  });

  test("throws JsonParseError, naming the file, on malformed JSON", () => {
    const file = path.join(sandbox, "broken.json");
    writeFileSync(file, "{ not json");
    assert.throws(() => readJsonFile(file), (error: unknown) => {
      assert.ok(error instanceof JsonParseError);
      assert.equal(error.file, file);
      return true;
    });
  });
});

describe("readJsonObject", () => {
  test("returns an empty object when the file is absent", () => {
    assert.deepEqual(readJsonObject(path.join(sandbox, "absent-object.json")), {});
  });

  test("rejects a top-level value that is not an object", () => {
    const file = path.join(sandbox, "array.json");
    writeJsonFile(file, [1, 2]);
    assert.throws(() => readJsonObject(file), JsonParseError);
  });
});

describe("writeJsonFile", () => {
  test("round-trips through readJsonObject", () => {
    const file = path.join(sandbox, "round-trip.json");
    writeJsonFile(file, { env: { OSO_STATE_BIN: "/bin/oso-state" } });
    assert.deepEqual(readJsonObject(file), { env: { OSO_STATE_BIN: "/bin/oso-state" } });
  });
});
