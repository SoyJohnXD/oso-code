import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { gzipSync } from "node:zlib";
import {
  curlOrWgetTransport,
  engramBinaryName,
  engramReleaseAsset,
  provisionEngramBinary,
  type EngramProvisionOutcome,
  type EngramTransport,
} from "../../src/install/engram.ts";
import { errorMessageOf } from "../../src/install/verify-claude.ts";
import { SUPPORTED_ENGRAM_VERSION } from "../../src/install/pins.ts";
import { isExecutableRegularFile, sha256Hex } from "../../src/state/store.ts";
import {
  buildTarGzFixture,
  buildZipFixture,
  tarOctalSizeField,
  type ArchiveFixtureEntry,
} from "../support/engram-archive-fixture.ts";
import { posixRelativeTo } from "../support/repository-paths.ts";
import { skipUnlessKernelRunsScriptFixtures } from "../support/win32-skip-guards.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-engram-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const RELEASE_SIZED_BYTES = 2 * 1024 * 1024;
const PLACEMENT_NEEDS_A_RUNNABLE_FIXTURE = skipUnlessKernelRunsScriptFixtures();
const THE_KERNEL_STARTS_THE_FIXTURE = PLACEMENT_NEEDS_A_RUNNABLE_FIXTURE === false;
const PLACEMENT_UNPROVED_ON_WIN32_UNTIL_S5_ACTIVATES_NIGHTLY =
  PLACEMENT_NEEDS_A_RUNNABLE_FIXTURE === false
    ? false
    : `${PLACEMENT_NEEDS_A_RUNNABLE_FIXTURE} — and the rename-and-report step this case asserts stays UNPROVED on win32 meanwhile: core/test/install/engram-nightly.test.ts is configured at .github/workflows/nightly.yml:152-157 on windows-latest but has never executed, because that step carries no if: and follows a Hook regression suite that is red there, which skips every step after it. C3-S5 activates it; absent that it stays dark until C3-S6 greens that suite`;
const RUNNABLE_BINARY = releaseSized(`#!${process.execPath}\nprocess.exit(0);\n`);
const RUNNABLE_PE_SHAPED_BINARY = releaseSized("MZ\nexit 0\n");

function releaseSized(source: string): Buffer {
  return Buffer.from(source.padEnd(RELEASE_SIZED_BYTES, " "), "utf8");
}

let sequence = 0;
function freshHome(): string {
  sequence += 1;
  return path.join(sandbox, `home-${sequence}`);
}

function checksumsText(rows: readonly { digest: string; file: string }[]): Buffer {
  return Buffer.from(rows.map((row) => `${row.digest}  ${row.file}\n`).join(""), "utf8");
}

function fixtureTransport(asset: string, archive: Buffer, checksums: Buffer): EngramTransport {
  return (url: string) => {
    if (url.endsWith("/checksums.txt")) return checksums;
    if (url.endsWith(`/${asset}`)) return archive;
    throw new Error(`fixture transport: no fixture wired for ${url}`);
  };
}

describe("engramReleaseAsset: the asset table per platform and arch", () => {
  const cases: readonly [NodeJS.Platform, NodeJS.Architecture, string | undefined][] = [
    ["linux", "x64", "engram_1.20.0_linux_amd64.tar.gz"],
    ["linux", "arm64", "engram_1.20.0_linux_arm64.tar.gz"],
    ["darwin", "x64", "engram_1.20.0_darwin_amd64.tar.gz"],
    ["darwin", "arm64", "engram_1.20.0_darwin_arm64.tar.gz"],
    ["win32", "x64", "engram_1.20.0_windows_amd64.zip"],
    ["win32", "arm64", "engram_1.20.0_windows_arm64.zip"],
    ["sunos", "x64", undefined],
    ["linux", "ia32", undefined],
  ];

  for (const [platform, architecture, expected] of cases) {
    test(`${platform}/${architecture} resolves to ${expected ?? "no published asset"}`, () => {
      assert.equal(engramReleaseAsset(platform, architecture, "1.20.0"), expected);
    });
  }
});

describe("engramBinaryName", () => {
  test("engram.exe on win32, engram everywhere else", () => {
    assert.equal(engramBinaryName("win32"), "engram.exe");
    assert.equal(engramBinaryName("linux"), "engram");
    assert.equal(engramBinaryName("darwin"), "engram");
  });
});

describe("provisionEngramBinary: checksum-verified download, extraction and placement", () => {
  test("places a checksum-matched tar.gz binary, executable and on PATH", { skip: PLACEMENT_NEEDS_A_RUNNABLE_FIXTURE }, () => {
    const homeDirectory = freshHome();
    const asset = `engram_${SUPPORTED_ENGRAM_VERSION}_linux_amd64.tar.gz`;
    const archive = buildTarGzFixture([{ name: "engram", content: RUNNABLE_BINARY }]);
    const transport = fixtureTransport(asset, archive, checksumsText([{ digest: sha256Hex(archive), file: asset }]));
    const installDirectory = path.join(homeDirectory, ".local", "bin");

    const outcome = provisionEngramBinary({
      homeDirectory,
      environment: { PATH: installDirectory },
      platform: "linux",
      architecture: "x64",
      transport,
    });

    assert.deepEqual(outcome, { kind: "installed-on-path", binary: path.join(installDirectory, "engram") });
    assert.equal(isExecutableRegularFile(path.join(installDirectory, "engram")), true);
  });

  test("reports installed-off-path when the install directory is not on PATH, without failing the placement", { skip: PLACEMENT_NEEDS_A_RUNNABLE_FIXTURE }, () => {
    const homeDirectory = freshHome();
    const asset = `engram_${SUPPORTED_ENGRAM_VERSION}_linux_amd64.tar.gz`;
    const archive = buildTarGzFixture([{ name: "engram", content: RUNNABLE_BINARY }]);
    const transport = fixtureTransport(asset, archive, checksumsText([{ digest: sha256Hex(archive), file: asset }]));

    const outcome = provisionEngramBinary({
      homeDirectory,
      environment: { PATH: "" },
      platform: "linux",
      architecture: "x64",
      transport,
    });

    const installDirectory = path.join(homeDirectory, ".local", "bin");
    assert.deepEqual(outcome, { kind: "installed-off-path", binary: path.join(installDirectory, "engram"), installDirectory });
    assert.equal(existsSync(path.join(installDirectory, "engram")), true);
  });

  test("names the binary this call placed, never the different engram that already answers to the bare name earlier on PATH", { skip: PLACEMENT_NEEDS_A_RUNNABLE_FIXTURE }, () => {
    const homeDirectory = freshHome();
    const incumbentDirectory = path.join(homeDirectory, "incumbent");
    mkdirSync(incumbentDirectory, { recursive: true });
    writeFileSync(path.join(incumbentDirectory, "engram"), RUNNABLE_BINARY, { mode: 0o755 });
    const installDirectory = path.join(homeDirectory, ".local", "bin");
    const asset = `engram_${SUPPORTED_ENGRAM_VERSION}_linux_amd64.tar.gz`;
    const archive = buildTarGzFixture([{ name: "engram", content: RUNNABLE_BINARY }]);
    const transport = fixtureTransport(asset, archive, checksumsText([{ digest: sha256Hex(archive), file: asset }]));

    const outcome = provisionEngramBinary({
      homeDirectory,
      environment: { PATH: `${incumbentDirectory}${path.delimiter}${installDirectory}` },
      platform: "linux",
      architecture: "x64",
      transport,
    });

    assert.deepEqual(outcome, { kind: "installed-off-path", binary: path.join(installDirectory, "engram"), installDirectory });
  });

  test("places a checksum-matched zip binary (stored, no compression) for windows", { skip: PLACEMENT_NEEDS_A_RUNNABLE_FIXTURE }, () => {
    const homeDirectory = freshHome();
    const asset = `engram_${SUPPORTED_ENGRAM_VERSION}_windows_amd64.zip`;
    const archive = buildZipFixture([{ name: "engram.exe", content: RUNNABLE_PE_SHAPED_BINARY }]);
    const transport = fixtureTransport(asset, archive, checksumsText([{ digest: sha256Hex(archive), file: asset }]));
    const installDirectory = path.join(homeDirectory, ".local", "bin");

    const outcome = provisionEngramBinary({
      homeDirectory,
      environment: { PATH: installDirectory },
      platform: "win32",
      architecture: "x64",
      transport,
    });

    assert.deepEqual(outcome, { kind: "installed-on-path", binary: path.join(installDirectory, "engram.exe") });
  });

  test("places a checksum-matched zip binary compressed with deflate", { skip: PLACEMENT_NEEDS_A_RUNNABLE_FIXTURE }, () => {
    const homeDirectory = freshHome();
    const asset = `engram_${SUPPORTED_ENGRAM_VERSION}_windows_amd64.zip`;
    const archive = buildZipFixture([{ name: "engram.exe", content: RUNNABLE_PE_SHAPED_BINARY, deflate: true }]);
    const transport = fixtureTransport(asset, archive, checksumsText([{ digest: sha256Hex(archive), file: asset }]));
    const installDirectory = path.join(homeDirectory, ".local", "bin");

    const outcome = provisionEngramBinary({
      homeDirectory,
      environment: { PATH: installDirectory },
      platform: "win32",
      architecture: "x64",
      transport,
    });

    assert.deepEqual(outcome, { kind: "installed-on-path", binary: path.join(installDirectory, "engram.exe") });
    assert.deepEqual(readFileSync(path.join(installDirectory, "engram.exe")), RUNNABLE_PE_SHAPED_BINARY);
  });

  test("a platform/arch this release never published fails before any transport call", () => {
    const outcome = provisionEngramBinary({
      homeDirectory: freshHome(),
      environment: {},
      platform: "sunos" as NodeJS.Platform,
      architecture: "x64",
      transport: () => {
        throw new Error("must not be called");
      },
    });
    assert.deepEqual(outcome, { kind: "failed", reason: "engram publishes no official release for sunos/x64" });
  });

  test("an archive missing the named binary fails, naming the asset", () => {
    const homeDirectory = freshHome();
    const asset = `engram_${SUPPORTED_ENGRAM_VERSION}_linux_amd64.tar.gz`;
    const archive = buildTarGzFixture([{ name: "README.md", content: Buffer.from("not a binary") }]);
    const transport = fixtureTransport(asset, archive, checksumsText([{ digest: sha256Hex(archive), file: asset }]));

    const outcome = provisionEngramBinary({ homeDirectory, environment: {}, platform: "linux", architecture: "x64", transport });
    assert.deepEqual(outcome, { kind: "failed", reason: `${asset} carries no engram` });
  });

  describe("checksum verification proves the mismatch case red, by construction — no bytes are ever placed on a mismatch", () => {
    function checksumMismatchOf(asset: string): EngramProvisionOutcome {
      return { kind: "failed", reason: `${asset} does not match its published SHA-256 checksum, so nothing was installed` };
    }

    test("a tampered archive against its published checksum fails, and places nothing on disk", () => {
      const homeDirectory = freshHome();
      const asset = `engram_${SUPPORTED_ENGRAM_VERSION}_linux_amd64.tar.gz`;
      const genuineArchive = buildTarGzFixture([{ name: "engram", content: RUNNABLE_BINARY }]);
      const publishedDigest = sha256Hex(genuineArchive);
      const tamperedArchive = buildTarGzFixture([{ name: "engram", content: Buffer.concat([RUNNABLE_BINARY, Buffer.from("tampered")]) }]);
      const transport = fixtureTransport(asset, tamperedArchive, checksumsText([{ digest: publishedDigest, file: asset }]));
      const installDirectory = path.join(homeDirectory, ".local", "bin");

      const outcome = provisionEngramBinary({ homeDirectory, environment: { PATH: installDirectory }, platform: "linux", architecture: "x64", transport });

      assert.deepEqual(outcome, checksumMismatchOf(asset));
      assert.equal(existsSync(installDirectory), false, "a mismatched download must place no directory, let alone a binary");
    });

    test("the matching digest for the same bytes is green — proving the red above was the checksum, not the fixture", () => {
      const homeDirectory = freshHome();
      const asset = `engram_${SUPPORTED_ENGRAM_VERSION}_linux_amd64.tar.gz`;
      const archive = buildTarGzFixture([{ name: "engram", content: RUNNABLE_BINARY }]);
      const transport = fixtureTransport(asset, archive, checksumsText([{ digest: sha256Hex(archive), file: asset }]));
      const installDirectory = path.join(homeDirectory, ".local", "bin");

      const outcome = provisionEngramBinary({ homeDirectory, environment: { PATH: installDirectory }, platform: "linux", architecture: "x64", transport });

      assert.notDeepEqual(outcome, checksumMismatchOf(asset), "the same bytes under their own digest must not reach the mismatch the case above asserts");
      if (THE_KERNEL_STARTS_THE_FIXTURE) assert.equal(outcome.kind, "installed-on-path");
    });

    test("zero matching rows in checksums.txt fails without downloading a byte to compare", () => {
      const homeDirectory = freshHome();
      const asset = `engram_${SUPPORTED_ENGRAM_VERSION}_linux_amd64.tar.gz`;
      const archive = buildTarGzFixture([{ name: "engram", content: RUNNABLE_BINARY }]);
      const transport = fixtureTransport(asset, archive, checksumsText([{ digest: sha256Hex(archive), file: "some-other-asset.tar.gz" }]));

      const outcome = provisionEngramBinary({ homeDirectory, environment: {}, platform: "linux", architecture: "x64", transport });
      assert.deepEqual(outcome, { kind: "failed", reason: `checksums.txt does not carry exactly one row for ${asset} (found 0)` });
    });

    test("two ambiguous matching rows in checksums.txt fails rather than picking one", () => {
      const homeDirectory = freshHome();
      const asset = `engram_${SUPPORTED_ENGRAM_VERSION}_linux_amd64.tar.gz`;
      const archive = buildTarGzFixture([{ name: "engram", content: RUNNABLE_BINARY }]);
      const digest = sha256Hex(archive);
      const transport = fixtureTransport(
        asset,
        archive,
        checksumsText([
          { digest, file: asset },
          { digest, file: asset },
        ]),
      );

      const outcome = provisionEngramBinary({ homeDirectory, environment: {}, platform: "linux", architecture: "x64", transport });
      assert.deepEqual(outcome, { kind: "failed", reason: `checksums.txt does not carry exactly one row for ${asset} (found 2)` });
    });

    test("a non-hex published digest fails rather than comparing against garbage", () => {
      const homeDirectory = freshHome();
      const asset = `engram_${SUPPORTED_ENGRAM_VERSION}_linux_amd64.tar.gz`;
      const archive = buildTarGzFixture([{ name: "engram", content: RUNNABLE_BINARY }]);
      const transport = fixtureTransport(asset, archive, checksumsText([{ digest: "not-a-hex-digest", file: asset }]));

      const outcome = provisionEngramBinary({ homeDirectory, environment: {}, platform: "linux", architecture: "x64", transport });
      assert.deepEqual(outcome, { kind: "failed", reason: `the published checksum for ${asset} is not a SHA-256 digest` });
    });
  });

  test("a binary that will not run never reaches the destination, and leaves no pending file behind", () => {
    const homeDirectory = freshHome();
    const asset = `engram_${SUPPORTED_ENGRAM_VERSION}_linux_amd64.tar.gz`;
    const archive = buildTarGzFixture([{ name: "engram", content: releaseSized("not an executable\n") }]);
    const transport = fixtureTransport(asset, archive, checksumsText([{ digest: sha256Hex(archive), file: asset }]));
    const installDirectory = path.join(homeDirectory, ".local", "bin");

    const outcome = provisionEngramBinary({ homeDirectory, environment: { PATH: installDirectory }, platform: "linux", architecture: "x64", transport });

    assert.equal(outcome.kind, "failed");
    assert.equal(existsSync(path.join(installDirectory, "engram")), false);
    assert.deepEqual(readdirSync(installDirectory), []);
  });

  test("a download the transport cannot reach fails with the url named, never silently", () => {
    const homeDirectory = freshHome();
    const transport: EngramTransport = () => {
      throw new Error("network unreachable");
    };
    const outcome = provisionEngramBinary({ homeDirectory, environment: {}, platform: "linux", architecture: "x64", transport });
    assert.equal(outcome.kind, "failed");
    if (outcome.kind === "failed") assert.match(outcome.reason, /could not download .*checksums\.txt/);
  });
});

describe("provisionEngramBinary: what a degenerate or hostile archive may not do to this machine", () => {
  const BOMB_UNCOMPRESSED_BYTES = 129 * 1024 * 1024;
  const OVER_DECLARED_BYTES = 99_999;
  const BUFFER_CEILING_REFUSAL = /Cannot create a Buffer larger than/;
  const DECLARED_SIZE_CEILING_REFUSAL = /past the \d+-byte ceiling this installer expands an archive under/;
  const TAR_ASSET = `engram_${SUPPORTED_ENGRAM_VERSION}_linux_amd64.tar.gz`;
  const ZIP_ASSET = `engram_${SUPPORTED_ENGRAM_VERSION}_windows_amd64.zip`;

  function provisionFrom(homeDirectory: string, asset: string, archive: Buffer): EngramProvisionOutcome {
    return provisionEngramBinary({
      homeDirectory,
      environment: { PATH: path.join(homeDirectory, ".local", "bin") },
      platform: asset.endsWith(".zip") ? "win32" : "linux",
      architecture: "x64",
      transport: fixtureTransport(asset, archive, checksumsText([{ digest: sha256Hex(archive), file: asset }])),
    });
  }

  function failureReason(outcome: EngramProvisionOutcome): string {
    assert.equal(outcome.kind, "failed", JSON.stringify(outcome));
    return outcome.kind === "failed" ? outcome.reason : "";
  }

  test("a gzip bomb is refused at the decompression ceiling instead of expanded into memory and onto disk", () => {
    const homeDirectory = freshHome();
    const archive = gzipSync(Buffer.alloc(BOMB_UNCOMPRESSED_BYTES));

    const reason = failureReason(provisionFrom(homeDirectory, TAR_ASSET, archive));

    assert.match(reason, BUFFER_CEILING_REFUSAL);
    assert.ok(
      BOMB_UNCOMPRESSED_BYTES / archive.length > 100,
      `${archive.length} archive byte(s) expanding to ${BOMB_UNCOMPRESSED_BYTES} is the ratio under test`,
    );
    assert.equal(existsSync(path.join(homeDirectory, ".local", "bin")), false);
  });

  test("a stored zip entry past that same ceiling is refused before a byte of it is copied out of the archive", () => {
    const homeDirectory = freshHome();
    const archive = buildZipFixture([{ name: "engram.exe", content: Buffer.alloc(BOMB_UNCOMPRESSED_BYTES) }]);

    assert.match(failureReason(provisionFrom(homeDirectory, ZIP_ASSET, archive)), DECLARED_SIZE_CEILING_REFUSAL);
    assert.equal(existsSync(path.join(homeDirectory, ".local", "bin")), false);
  });

  test("a zip entry that inflates past the same ceiling is refused on the deflate path too", () => {
    const homeDirectory = freshHome();
    const archive = buildZipFixture([{ name: "engram.exe", content: Buffer.alloc(BOMB_UNCOMPRESSED_BYTES), deflate: true }]);

    assert.match(failureReason(provisionFrom(homeDirectory, ZIP_ASSET, archive)), BUFFER_CEILING_REFUSAL);
    assert.equal(existsSync(path.join(homeDirectory, ".local", "bin")), false);
  });

  test("a release-sized payload passes that ceiling, so the bomb above was refused by its size and not by its shape", () => {
    const homeDirectory = freshHome();
    const archive = buildTarGzFixture([{ name: "engram", content: RUNNABLE_BINARY }]);

    const outcome = provisionFrom(homeDirectory, TAR_ASSET, archive);

    const refusalReasonIfAny = outcome.kind === "failed" ? outcome.reason : "";
    assert.doesNotMatch(refusalReasonIfAny, BUFFER_CEILING_REFUSAL);
    assert.doesNotMatch(refusalReasonIfAny, DECLARED_SIZE_CEILING_REFUSAL);
    if (THE_KERNEL_STARTS_THE_FIXTURE) assert.equal(outcome.kind, "installed-on-path");
  });

  test("a pre-existing binary survives a failed provision, rather than being replaced and then deleted", () => {
    const homeDirectory = freshHome();
    const installDirectory = path.join(homeDirectory, ".local", "bin");
    mkdirSync(installDirectory, { recursive: true });
    const incumbent = "the engram this machine already had\n";
    writeFileSync(path.join(installDirectory, "engram"), incumbent, { mode: 0o755 });
    const archive = buildTarGzFixture([{ name: "engram", content: releaseSized("not an executable\n") }]);

    failureReason(provisionFrom(homeDirectory, TAR_ASSET, archive));

    assert.equal(readFileSync(path.join(installDirectory, "engram"), "utf8"), incumbent);
    assert.deepEqual(readdirSync(installDirectory), ["engram"]);
  });

  test(
    "a rename that cannot land, reached only once the run probe has passed the placed bytes, leaves no pending file behind in the install directory",
    { skip: PLACEMENT_UNPROVED_ON_WIN32_UNTIL_S5_ACTIVATES_NIGHTLY },
    () => {
      const homeDirectory = freshHome();
      const installDirectory = path.join(homeDirectory, ".local", "bin");
      mkdirSync(path.join(installDirectory, "engram", "occupied"), { recursive: true });
      const archive = buildTarGzFixture([{ name: "engram", content: RUNNABLE_BINARY }]);

      failureReason(provisionFrom(homeDirectory, TAR_ASSET, archive));

      assert.deepEqual(readdirSync(installDirectory), ["engram"]);
    },
  );

  test("a negative octal size field is refused as no byte count, rather than yielding a zero-byte binary", () => {
    const homeDirectory = freshHome();
    const archive = buildTarGzFixture([{ name: "engram", content: Buffer.from("x"), headerLies: { octalSize: "-0000000001" } }]);

    assert.match(failureReason(provisionFrom(homeDirectory, TAR_ASSET, archive)), /which is no byte count/);
    assert.equal(existsSync(path.join(homeDirectory, ".local", "bin")), false);
  });

  test("an `exit 0` shell script is refused for being no release binary, before the run probe ever sees it", () => {
    const homeDirectory = freshHome();
    const archive = buildTarGzFixture([{ name: "engram", content: Buffer.from("exit 0\n") }]);

    assert.match(failureReason(provisionFrom(homeDirectory, TAR_ASSET, archive)), /rather than the Go binary this release publishes/);
    assert.equal(existsSync(path.join(homeDirectory, ".local", "bin")), false);
  });

  test("a tar header declaring more content than the archive holds errors instead of truncating in silence", () => {
    const homeDirectory = freshHome();
    const archive = buildTarGzFixture([
      { name: "engram", content: RUNNABLE_BINARY, headerLies: { octalSize: tarOctalSizeField(RUNNABLE_BINARY.length + OVER_DECLARED_BYTES) } },
    ]);

    assert.match(failureReason(provisionFrom(homeDirectory, TAR_ASSET, archive)), /content bytes but the archive holds only/);
  });

  test("a zip entry declaring more compressed bytes than the archive holds errors instead of truncating in silence", () => {
    const homeDirectory = freshHome();
    const archive = buildZipFixture([
      { name: "engram.exe", content: RUNNABLE_BINARY, headerLies: { zipCompressedSize: RUNNABLE_BINARY.length + OVER_DECLARED_BYTES } },
    ]);

    assert.match(failureReason(provisionFrom(homeDirectory, ZIP_ASSET, archive)), /compressed bytes but the archive holds only/);
  });

  test("a decoy entry ordered before the real one is refused as ambiguous, so order never decides what is installed", () => {
    const homeDirectory = freshHome();
    const archive = buildTarGzFixture([
      { name: "decoy/engram", content: releaseSized("#!/bin/sh\nexit 0\n") },
      { name: "engram", content: RUNNABLE_BINARY },
    ]);

    const reason = failureReason(provisionFrom(homeDirectory, TAR_ASSET, archive));

    assert.match(reason, /carries 2 entries named engram \(decoy\/engram, engram\)/);
    assert.equal(existsSync(path.join(homeDirectory, ".local", "bin")), false);
  });

  test("a transport failure surfaces the cause it was handed, not only the url it could not reach", () => {
    const outcome = provisionEngramBinary({
      homeDirectory: freshHome(),
      environment: {},
      platform: "linux",
      architecture: "x64",
      transport: () => {
        throw new Error("neither curl nor wget is installed here");
      },
    });

    assert.match(failureReason(outcome), /could not download .*checksums\.txt: neither curl nor wget is installed here$/);
  });
});

describe("curlOrWgetTransport: what the operator is told when the fetcher itself refuses a url", () => {
  test("carries what curl or wget said about the refusal, not only the exit code it returned", () => {
    let refusal = "";
    try {
      curlOrWgetTransport(process.env)("file:///oso-code-no-such-engram-release-asset");
    } catch (error) {
      refusal = errorMessageOf(error);
    }

    assert.match(refusal, /^(curl|wget) exited \d+: \S/);
  });
});

describe("the extractor never uses an archive entry name as a write path", () => {
  const canaryDirectory = path.join(sandbox, "canary");
  mkdirSync(canaryDirectory, { recursive: true });
  const escapeTarget = path.join(canaryDirectory, "PWNED");

  const hostileArchives: readonly (readonly [string, string, ArchiveFixtureEntry])[] = [
    ["a parent-relative name", "tar", { name: `../../../../../../../..${escapeTarget}`, content: RUNNABLE_BINARY }],
    ["an absolute name", "tar", { name: escapeTarget, content: RUNNABLE_BINARY }],
    ["a ustar prefix-field escape", "tar", { name: "engram", content: RUNNABLE_BINARY, headerLies: { tarPrefix: canaryDirectory } }],
    ["a symlink typeflag", "tar", { name: "engram", content: RUNNABLE_BINARY, headerLies: { tarTypeflag: 0x32 } }],
    ["a central-vs-local name disagreement", "zip", { name: "engram.exe", content: RUNNABLE_BINARY, headerLies: { zipLocalName: `../..${escapeTarget}` } }],
  ];

  for (const [label, kind, entry] of hostileArchives) {
    test(`${label} writes nothing outside the path this code composes itself`, () => {
      const homeDirectory = freshHome();
      const asset = kind === "zip" ? `engram_${SUPPORTED_ENGRAM_VERSION}_windows_amd64.zip` : `engram_${SUPPORTED_ENGRAM_VERSION}_linux_amd64.tar.gz`;
      const archive = kind === "zip" ? buildZipFixture([entry]) : buildTarGzFixture([entry]);
      const binaryName = kind === "zip" ? "engram.exe" : "engram";

      provisionEngramBinary({
        homeDirectory,
        environment: {},
        platform: kind === "zip" ? "win32" : "linux",
        architecture: "x64",
        transport: fixtureTransport(asset, archive, checksumsText([{ digest: sha256Hex(archive), file: asset }])),
      });

      assert.deepEqual(readdirSync(canaryDirectory), [], `${label} wrote into the canary directory`);
      assert.deepEqual(
        filesUnder(homeDirectory).map((file) => posixRelativeTo(homeDirectory, file)),
        existsSync(path.join(homeDirectory, ".local", "bin", binaryName)) ? [`.local/bin/${binaryName}`] : [],
      );
    });
  }
});

function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}
