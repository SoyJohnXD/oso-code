import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { sha256Hex } from "../state/store.ts";
import { SUPPORTED_ENGRAM_VERSION } from "./pins.ts";
import { parseTrustManifest, SHA256_HEX_PATTERN } from "./trust.ts";
import { collapsedNewlines, engramBinaryRuns, errorMessageOf, firstExecutableOnPath } from "./verify-claude.ts";

export const ENGRAM_SOURCE_REPO = "Gentleman-Programming/engram";

const DOWNLOAD_BOUND_SECONDS = 120;
const MEBIBYTE = 1024 * 1024;
export const SCRIPT_SIZED_PAYLOAD_FLOOR_BYTES = MEBIBYTE;
export const ARCHIVE_EXPANSION_CEILING_BYTES = 128 * MEBIBYTE;

export type EngramTransport = (url: string) => Buffer;

export type ProvisionEngramInput = Readonly<{
  homeDirectory: string;
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  architecture: NodeJS.Architecture;
  transport?: EngramTransport;
}>;

export type EngramProvisionOutcome =
  | Readonly<{ kind: "installed-on-path"; binary: string }>
  | Readonly<{ kind: "installed-off-path"; binary: string; installDirectory: string }>
  | Readonly<{ kind: "failed"; reason: string }>;

export class EngramProvisionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EngramProvisionError";
  }
}

export function provisionEngramBinary(input: ProvisionEngramInput): EngramProvisionOutcome {
  const installDirectory = path.join(input.homeDirectory, ".local", "bin");
  const binaryName = engramBinaryName(input.platform);
  const transport = input.transport ?? curlOrWgetTransport(input.environment);
  let placedBinary: string;
  try {
    const content = fetchVerifiedEngramBinary(input.platform, input.architecture, binaryName, transport);
    placedBinary = placeEngramBinary({ content, installDirectory, binaryName, environment: input.environment, platform: input.platform });
  } catch (error) {
    return { kind: "failed", reason: errorMessageOf(error) };
  }
  return firstExecutableOnPath(input.environment, binaryName) === placedBinary
    ? { kind: "installed-on-path", binary: placedBinary }
    : { kind: "installed-off-path", binary: placedBinary, installDirectory };
}

export function engramBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "engram.exe" : "engram";
}

export function engramReleaseAsset(platform: NodeJS.Platform, architecture: NodeJS.Architecture, version: string): string | undefined {
  const os = engramReleaseOs(platform);
  const arch = engramReleaseArch(architecture);
  if (os === undefined || arch === undefined) return undefined;
  return os === "windows" ? `engram_${version}_windows_${arch}.zip` : `engram_${version}_${os}_${arch}.tar.gz`;
}

function fetchVerifiedEngramBinary(
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
  binaryName: string,
  transport: EngramTransport,
): Buffer {
  const asset = engramReleaseAsset(platform, architecture, SUPPORTED_ENGRAM_VERSION);
  if (asset === undefined) {
    throw new EngramProvisionError(`engram publishes no official release for ${platform}/${architecture}`);
  }
  const releaseBase = `https://github.com/${ENGRAM_SOURCE_REPO}/releases/download/v${SUPPORTED_ENGRAM_VERSION}`;
  const checksums = downloadOrThrow(transport, `${releaseBase}/checksums.txt`);
  const archive = downloadOrThrow(transport, `${releaseBase}/${asset}`);
  verifyEngramChecksum(checksums, archive, asset);
  return engramBinaryFromArchive(archive, asset, binaryName);
}

function downloadOrThrow(transport: EngramTransport, url: string): Buffer {
  try {
    return transport(url);
  } catch (cause) {
    throw new EngramProvisionError(`could not download ${url}: ${errorMessageOf(cause)}`, { cause });
  }
}

function verifyEngramChecksum(checksumsText: Buffer, archive: Buffer, asset: string): void {
  const rows = parseTrustManifest(checksumsText.toString("utf8")).filter((row) => row.file === asset);
  if (rows.length !== 1) {
    throw new EngramProvisionError(`checksums.txt does not carry exactly one row for ${asset} (found ${rows.length})`);
  }
  const [row] = rows as [{ digest: string; file: string }];
  if (!SHA256_HEX_PATTERN.test(row.digest)) {
    throw new EngramProvisionError(`the published checksum for ${asset} is not a SHA-256 digest`);
  }
  if (sha256Hex(archive) !== row.digest) {
    throw new EngramProvisionError(`${asset} does not match its published SHA-256 checksum, so nothing was installed`);
  }
}

type EngramPlacement = Readonly<{
  content: Buffer;
  installDirectory: string;
  binaryName: string;
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}>;

function placeEngramBinary({ content, installDirectory, binaryName, environment, platform }: EngramPlacement): string {
  if (content.length < SCRIPT_SIZED_PAYLOAD_FLOOR_BYTES) {
    throw new EngramProvisionError(
      `the ${binaryName} entry holds ${content.length} bytes, under the ${SCRIPT_SIZED_PAYLOAD_FLOOR_BYTES} bytes below which it is a script or a text file rather than the Go binary this release publishes, so nothing was placed`,
    );
  }
  mkdirSync(installDirectory, { recursive: true });
  const target = path.join(installDirectory, binaryName);
  const pending = path.join(installDirectory, `.oso-pending-${process.pid}-${binaryName}`);
  writeFileSync(pending, content, { mode: 0o755 });
  try {
    if (!engramBinaryRuns(platform, pending, environment)) {
      throw new EngramProvisionError(
        `engram ${SUPPORTED_ENGRAM_VERSION} was verified but would not run from ${installDirectory}, so ${target} was left exactly as it was — an antivirus may have quarantined it, which upstream documents happening to its unsigned prebuilt releases`,
      );
    }
    renameSync(pending, target);
  } catch (error) {
    rmSync(pending, { force: true });
    throw error;
  }
  return target;
}

export function curlOrWgetTransport(environment: NodeJS.ProcessEnv): EngramTransport {
  return (url) => {
    const scratch = mkdtempSync(path.join(tmpdir(), "oso-engram-download-"));
    try {
      const destination = path.join(scratch, "download");
      downloadToFile(url, destination, environment);
      return readFileSync(destination);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };
}

function downloadToFile(url: string, destination: string, environment: NodeJS.ProcessEnv): void {
  const bound = String(DOWNLOAD_BOUND_SECONDS);
  const curl = spawnSync(
    "curl",
    ["-fsSL", "--retry", "3", "--retry-delay", "2", "--connect-timeout", bound, "--max-time", bound, "-o", destination, url],
    { env: environment, encoding: "utf8" },
  );
  if (curl.error === undefined) {
    if (curl.status !== 0) throw new Error(fetcherRefusal("curl", curl));
    return;
  }
  const wget = spawnSync("wget", ["-nv", "--tries=3", `--timeout=${bound}`, "-O", destination, url], {
    env: environment,
    encoding: "utf8",
  });
  if (wget.error !== undefined) throw new Error("neither curl nor wget is installed here");
  if (wget.status !== 0) throw new Error(fetcherRefusal("wget", wget));
}

function fetcherRefusal(fetcher: string, result: Readonly<{ status: number | null; stderr: string }>): string {
  const said = collapsedNewlines(result.stderr).trim();
  return said === "" ? `${fetcher} exited ${result.status}` : `${fetcher} exited ${result.status}: ${said}`;
}

function engramReleaseOs(platform: NodeJS.Platform): "linux" | "darwin" | "windows" | undefined {
  if (platform === "linux") return "linux";
  if (platform === "darwin") return "darwin";
  if (platform === "win32") return "windows";
  return undefined;
}

function engramReleaseArch(architecture: NodeJS.Architecture): "amd64" | "arm64" | undefined {
  if (architecture === "x64") return "amd64";
  if (architecture === "arm64") return "arm64";
  return undefined;
}

type ArchiveEntry = Readonly<{ name: string; readContent: () => Buffer }>;

function engramBinaryFromArchive(archive: Buffer, asset: string, binaryName: string): Buffer {
  const entries = asset.endsWith(".zip") ? zipEntries(archive) : tarGzEntries(archive);
  const named = entries.filter((entry) => path.posix.basename(entry.name) === binaryName);
  const [only] = named;
  if (only === undefined) throw new EngramProvisionError(`${asset} carries no ${binaryName}`);
  if (named.length > 1) {
    throw new EngramProvisionError(
      `${asset} carries ${named.length} entries named ${binaryName} (${named.map((entry) => entry.name).join(", ")}), so which one is the release binary is ambiguous and nothing was installed`,
    );
  }
  return only.readContent();
}

const TAR_BLOCK_BYTES = 512;
const TAR_NAME_OFFSET = 0;
const TAR_NAME_BYTES = 100;
const TAR_SIZE_OFFSET = 124;
const TAR_SIZE_BYTES = 12;
const TAR_TYPEFLAG_OFFSET = 156;
const TAR_PREFIX_OFFSET = 345;
const TAR_PREFIX_BYTES = 155;
const TAR_REGULAR_FILE_TYPEFLAG = 0x30;
const TAR_IMPLICIT_REGULAR_FILE_TYPEFLAG = 0;

function tarGzEntries(archive: Buffer): ArchiveEntry[] {
  return tarEntries(gunzipSync(archive, { maxOutputLength: ARCHIVE_EXPANSION_CEILING_BYTES }));
}

function tarEntries(tar: Buffer): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  while (offset + TAR_BLOCK_BYTES <= tar.length && !isZeroBlock(tar, offset)) {
    const name = tarField(tar, offset, TAR_NAME_OFFSET, TAR_NAME_BYTES);
    const prefix = tarField(tar, offset, TAR_PREFIX_OFFSET, TAR_PREFIX_BYTES);
    const size = tarDeclaredSize(tar, offset);
    const contentStart = offset + TAR_BLOCK_BYTES;
    if (contentStart + size > tar.length) {
      throw new EngramProvisionError(
        `a tar header declares ${size} content bytes but the archive holds only ${tar.length - contentStart} past it`,
      );
    }
    if (isTarRegularFile(tar[offset + TAR_TYPEFLAG_OFFSET])) {
      entries.push({
        name: prefix === "" ? name : `${prefix}/${name}`,
        readContent: () => Buffer.from(tar.subarray(contentStart, contentStart + size)),
      });
    }
    offset = contentStart + roundUpToBlock(size);
  }
  return entries;
}

function tarDeclaredSize(tar: Buffer, blockOffset: number): number {
  const field = tarField(tar, blockOffset, TAR_SIZE_OFFSET, TAR_SIZE_BYTES).trim();
  const size = field === "" ? 0 : Number.parseInt(field, 8);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new EngramProvisionError(`a tar header declares ${JSON.stringify(field)} as its octal content size, which is no byte count`);
  }
  return size;
}

function isTarRegularFile(typeflag: number | undefined): boolean {
  return typeflag === TAR_REGULAR_FILE_TYPEFLAG || typeflag === TAR_IMPLICIT_REGULAR_FILE_TYPEFLAG;
}

function tarField(tar: Buffer, blockOffset: number, fieldOffset: number, length: number): string {
  const field = tar.subarray(blockOffset + fieldOffset, blockOffset + fieldOffset + length);
  const terminator = field.indexOf(0);
  return (terminator === -1 ? field : field.subarray(0, terminator)).toString("latin1");
}

function isZeroBlock(tar: Buffer, offset: number): boolean {
  return tar.subarray(offset, offset + TAR_BLOCK_BYTES).every((byte) => byte === 0);
}

function roundUpToBlock(size: number): number {
  return Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
}

const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const ZIP_TOTAL_ENTRY_COUNT_OFFSET = 10;
const ZIP_DIRECTORY_START_OFFSET = 16;
const ZIP_CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const ZIP_CENTRAL_FILE_HEADER_BYTES = 46;
const ZIP_CENTRAL_METHOD_OFFSET = 10;
const ZIP_CENTRAL_COMPRESSED_SIZE_OFFSET = 20;
const ZIP_CENTRAL_NAME_LENGTH_OFFSET = 28;
const ZIP_CENTRAL_EXTRA_LENGTH_OFFSET = 30;
const ZIP_CENTRAL_COMMENT_LENGTH_OFFSET = 32;
const ZIP_CENTRAL_LOCAL_HEADER_START_OFFSET = 42;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_LOCAL_FILE_HEADER_BYTES = 30;
const ZIP_LOCAL_NAME_LENGTH_OFFSET = 26;
const ZIP_LOCAL_EXTRA_LENGTH_OFFSET = 28;
const ZIP_STORED_METHOD = 0;

function zipEntries(zip: Buffer): ArchiveEntry[] {
  const trailer = findZipEndOfCentralDirectory(zip);
  const entryCount = zip.readUInt16LE(trailer + ZIP_TOTAL_ENTRY_COUNT_OFFSET);
  const entries: ArchiveEntry[] = [];
  let offset = zip.readUInt32LE(trailer + ZIP_DIRECTORY_START_OFFSET);
  for (let index = 0; index < entryCount; index += 1) {
    if (zip.readUInt32LE(offset) !== ZIP_CENTRAL_FILE_HEADER_SIGNATURE) {
      throw new EngramProvisionError("not a zip archive: central directory entry signature mismatch");
    }
    const method = zip.readUInt16LE(offset + ZIP_CENTRAL_METHOD_OFFSET);
    const compressedSize = zip.readUInt32LE(offset + ZIP_CENTRAL_COMPRESSED_SIZE_OFFSET);
    const nameLength = zip.readUInt16LE(offset + ZIP_CENTRAL_NAME_LENGTH_OFFSET);
    const extraLength = zip.readUInt16LE(offset + ZIP_CENTRAL_EXTRA_LENGTH_OFFSET);
    const commentLength = zip.readUInt16LE(offset + ZIP_CENTRAL_COMMENT_LENGTH_OFFSET);
    const localHeaderStart = zip.readUInt32LE(offset + ZIP_CENTRAL_LOCAL_HEADER_START_OFFSET);
    const nameStart = offset + ZIP_CENTRAL_FILE_HEADER_BYTES;
    entries.push({
      name: zip.subarray(nameStart, nameStart + nameLength).toString("utf8"),
      readContent: () => zipEntryContent(zip, localHeaderStart, method, compressedSize),
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

function zipEntryContent(zip: Buffer, localHeaderStart: number, method: number, compressedSize: number): Buffer {
  if (zip.readUInt32LE(localHeaderStart) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw new EngramProvisionError("not a zip archive: local file header signature mismatch");
  }
  if (compressedSize > ARCHIVE_EXPANSION_CEILING_BYTES) {
    throw new EngramProvisionError(
      `a zip entry declares ${compressedSize} compressed bytes, past the ${ARCHIVE_EXPANSION_CEILING_BYTES}-byte ceiling this installer expands an archive under`,
    );
  }
  const nameLength = zip.readUInt16LE(localHeaderStart + ZIP_LOCAL_NAME_LENGTH_OFFSET);
  const extraLength = zip.readUInt16LE(localHeaderStart + ZIP_LOCAL_EXTRA_LENGTH_OFFSET);
  const dataStart = localHeaderStart + ZIP_LOCAL_FILE_HEADER_BYTES + nameLength + extraLength;
  if (dataStart + compressedSize > zip.length) {
    throw new EngramProvisionError(
      `a zip entry declares ${compressedSize} compressed bytes but the archive holds only ${zip.length - dataStart} past its local file header`,
    );
  }
  const raw = zip.subarray(dataStart, dataStart + compressedSize);
  return method === ZIP_STORED_METHOD ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: ARCHIVE_EXPANSION_CEILING_BYTES });
}

function findZipEndOfCentralDirectory(zip: Buffer): number {
  for (let offset = zip.length - ZIP_END_OF_CENTRAL_DIRECTORY_BYTES; offset >= 0; offset -= 1) {
    if (zip.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  throw new EngramProvisionError("not a zip archive: no end-of-central-directory record");
}
