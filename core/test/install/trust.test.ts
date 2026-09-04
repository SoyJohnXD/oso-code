import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { sha256Hex } from "../../src/state/store.ts";
import { parseTrustManifest, trustDivergences } from "../../src/install/trust.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-trust-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const DIGEST = sha256Hex("payload");

describe("parseTrustManifest", () => {
  test("splits a 64-hex-digest, two-space, path row", () => {
    assert.deepEqual(parseTrustManifest(`${DIGEST}  plugin/dist/gate.js\n`), [{ digest: DIGEST, file: "plugin/dist/gate.js" }]);
  });

  test("skips blank lines and comments", () => {
    assert.deepEqual(parseTrustManifest(`\n# a comment\n${DIGEST}  plugin/dist/gate.js\n`), [
      { digest: DIGEST, file: "plugin/dist/gate.js" },
    ]);
  });
});

describe("trustDivergences", () => {
  const excludeCodex = (relative: string): boolean => relative.startsWith("codex/");

  test("reports missing-manifest when the manifest file is not there", () => {
    const manifest = path.join(sandbox, "absent.txt");
    assert.deepEqual(trustDivergences(manifest, excludeCodex, () => undefined), [{ file: manifest, state: { kind: "missing-manifest" } }]);
  });

  test("a matching digest publishes nothing", () => {
    const manifest = path.join(sandbox, "clean.txt");
    const target = path.join(sandbox, "gate.js");
    writeFileSync(target, "payload");
    writeFileSync(manifest, `${DIGEST}  plugin/dist/gate.js\n`);
    assert.deepEqual(trustDivergences(manifest, excludeCodex, () => target), []);
  });

  test("a mismatched digest reports the actual hash", () => {
    const manifest = path.join(sandbox, "stale.txt");
    const target = path.join(sandbox, "stale-gate.js");
    writeFileSync(target, "tampered");
    writeFileSync(manifest, `${DIGEST}  plugin/dist/gate.js\n`);
    assert.deepEqual(trustDivergences(manifest, excludeCodex, () => target), [
      { file: "plugin/dist/gate.js", state: { kind: "mismatch", actual: sha256Hex("tampered") } },
    ]);
  });

  test("a target the resolver cannot place is outside-the-trust-set", () => {
    const manifest = path.join(sandbox, "unmapped.txt");
    writeFileSync(manifest, `${DIGEST}  unknown/path.js\n`);
    assert.deepEqual(trustDivergences(manifest, excludeCodex, () => undefined), [
      { file: "unknown/path.js", state: { kind: "outside-the-trust-set" } },
    ]);
  });

  test("a resolved target that is not there reports missing", () => {
    const manifest = path.join(sandbox, "missing-target.txt");
    writeFileSync(manifest, `${DIGEST}  plugin/dist/gate.js\n`);
    assert.deepEqual(trustDivergences(manifest, excludeCodex, () => path.join(sandbox, "never-written.js")), [
      { file: "plugin/dist/gate.js", state: { kind: "missing" } },
    ]);
  });

  test("a malformed published digest is reported without touching the filesystem", () => {
    const manifest = path.join(sandbox, "malformed.txt");
    writeFileSync(manifest, "not-hex  plugin/dist/gate.js\n");
    assert.deepEqual(trustDivergences(manifest, excludeCodex, () => manifest), [
      { file: "plugin/dist/gate.js", state: { kind: "malformed-published-hash" } },
    ]);
  });

  test("the exclusion predicate skips a host's own foreign rows entirely", () => {
    const manifest = path.join(sandbox, "excluded.txt");
    writeFileSync(manifest, `${DIGEST}  codex/config-template.toml\n`);
    assert.deepEqual(trustDivergences(manifest, excludeCodex, () => manifest), []);
  });

  test("hashes an invalid-UTF-8 target by its raw bytes rather than a lossy utf8 decode", () => {
    const manifest = path.join(sandbox, "binary.txt");
    const target = path.join(sandbox, "binary-gate.js");
    const invalidUtf8Payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01, 0xc0, 0x80]);
    writeFileSync(target, invalidUtf8Payload);
    writeFileSync(manifest, `${sha256Hex(invalidUtf8Payload)}  plugin/dist/gate.js\n`);
    assert.deepEqual(trustDivergences(manifest, excludeCodex, () => target), []);
  });
});
