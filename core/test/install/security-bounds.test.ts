import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ARCHIVE_EXPANSION_CEILING_BYTES, SCRIPT_SIZED_PAYLOAD_FLOOR_BYTES } from "../../src/install/engram.ts";
import { ENGRAM_PROBE_ENVIRONMENT_KEYS, ENGRAM_PROBE_TIMEOUT_MS } from "../../src/install/verify-claude.ts";

const MEASURED_RELEASE_BINARY = "the 19,517,624-byte engram 1.20.0 linux_amd64 release binary this pin ships";
const MEASURED_VERSION_PROBE = "the 340 ms that same binary takes to answer `engram version` off a warm page cache";

const SECURITY_BOUNDS = [
  {
    label: "the ceiling an archive may expand under",
    enforced: ARCHIVE_EXPANSION_CEILING_BYTES,
    derived: 134_217_728,
    derivation:
      `6 × ${MEASURED_RELEASE_BINARY} = 117,105,744 B, rounded up to the next power of two = 128 MiB — room for that binary ` +
      "to grow across pins and for the README and licence packed beside it, and far under what a decompression bomb wants",
  },
  {
    label: "the floor a payload must clear before anything is placed",
    enforced: SCRIPT_SIZED_PAYLOAD_FLOOR_BYTES,
    derived: 1_048_576,
    derivation:
      `1 MiB, 18.6× under ${MEASURED_RELEASE_BINARY} — a smoke floor that catches a script or a text file standing in for a Go ` +
      "binary, and no security bound at all: the published SHA-256 match is the only thing that makes the payload the release",
  },
  {
    label: "the bound the run probe holds a just-placed binary to",
    enforced: ENGRAM_PROBE_TIMEOUT_MS,
    derived: 10_000,
    derivation:
      `10 s, 29 × ${MEASURED_VERSION_PROBE} — the headroom a first run behind a Windows on-access antivirus scan of a 19 MB ` +
      "unsigned binary needs, and short enough that a quarantined binary never holds the installer past ten seconds",
  },
  {
    label: "the environment the run probe hands that binary",
    enforced: ENGRAM_PROBE_ENVIRONMENT_KEYS,
    derived: ["PATH", "SystemRoot", "windir"],
    derivation:
      "PATH, against which the binary resolves anything it spawns, plus SystemRoot and windir, without which a Windows process " +
      "cannot reach %SystemRoot%\\System32 to start at all — every other variable the operator's environment carries, secrets among them, is withheld",
  },
] as const;

describe("every bound this installer enforces states the measurement it came from", () => {
  for (const { label, enforced, derived, derivation } of SECURITY_BOUNDS) {
    test(`${label} is ${derivation}`, () => {
      assert.deepEqual(enforced, derived, `${label} no longer matches the derivation this test carries`);
    });
  }
});
