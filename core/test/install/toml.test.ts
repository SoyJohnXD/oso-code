import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import * as tomlModule from "../../src/install/toml.ts";
import { parseTomlDocument, readTomlFile, TomlParseError } from "../../src/install/toml.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-toml-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

describe("parseTomlDocument", () => {
  test("parses a well-formed document into its keys", () => {
    assert.deepEqual(parseTomlDocument('name = "oso"\nport = 7\n', "inline.toml"), { name: "oso", port: 7 });
  });

  test("wraps a malformed document in TomlParseError, naming the file", () => {
    assert.throws(() => parseTomlDocument("not = = toml", "broken.toml"), (error: unknown) => {
      assert.ok(error instanceof TomlParseError);
      assert.equal(error.file, "broken.toml");
      return true;
    });
  });

  test("never re-emits the document — the module's export surface carries no stringify, though smol-toml's own does", () => {
    const source = "# a comment smol-toml would drop on a round trip\nname = \"oso\"\n";
    const parsed = parseTomlDocument(source, "inline.toml");
    assert.deepEqual(parsed, { name: "oso" });
    assert.deepEqual(Object.keys(tomlModule).sort(), ["TomlParseError", "parseTomlDocument", "readTomlFile"]);
  });
});

describe("readTomlFile", () => {
  test("returns undefined for a file that is not there", () => {
    assert.equal(readTomlFile(path.join(sandbox, "absent.toml")), undefined);
  });

  test("reads a present file's parsed value", () => {
    const file = path.join(sandbox, "present.toml");
    writeFileSync(file, 'model = "oso-code"\n');
    assert.deepEqual(readTomlFile(file), { model: "oso-code" });
  });
});
