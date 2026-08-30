import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { engramBinaryName, provisionEngramBinary } from "../../src/install/engram.ts";
import { isExecutableRegularFile } from "../../src/state/store.ts";

const NIGHTLY = process.env["OSO_NIGHTLY"] === "1";
const SKIP_REASON = "the PR gate passes a stub transport; the real download, checksum and placement are nightly's, under OSO_NIGHTLY=1";

test(
  "provisionEngramBinary fetches the real pinned engram release, verifies its published checksum and places a binary that runs — reported off-path, because a mkdtemp install directory is on no runner's PATH",
  { skip: NIGHTLY ? false : SKIP_REASON },
  () => {
    const homeDirectory = mkdtempSync(path.join(tmpdir(), "oso-engram-nightly-"));
    const installDirectory = path.join(homeDirectory, ".local", "bin");
    const placedBinary = path.join(installDirectory, engramBinaryName(process.platform));
    try {
      const outcome = provisionEngramBinary({
        homeDirectory,
        environment: process.env,
        platform: process.platform,
        architecture: process.arch,
      });

      assert.deepEqual(outcome, { kind: "installed-off-path", binary: placedBinary, installDirectory });
      assert.equal(isExecutableRegularFile(placedBinary), true, `${placedBinary} was reported placed but is not an executable regular file`);
    } finally {
      rmSync(homeDirectory, { recursive: true, force: true });
    }
  },
);
