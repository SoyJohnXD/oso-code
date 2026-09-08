import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type Stats } from "node:fs";

class CodexMetadataFailure extends Error {}

export type CodexSessionMetadata = Readonly<{
  id: string;
  cwd: string;
  parentThreadId: string | undefined;
  agentPath: string | undefined;
  agentRole: string | undefined;
  source: unknown;
  threadSpawn: Readonly<Record<string, unknown>> | undefined;
}>;

export const CODEX_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CODEX_METADATA_READINESS_MS = 10000;
const MAX_FIRST_RECORD_BYTES = 1024 * 1024;

export function readCodexSessionMetadata(file: string, deadline: number): CodexSessionMetadata {
  const { text } = readBoundedRegularFile({ file, deadline, maxBytes: MAX_FIRST_RECORD_BYTES, firstRecord: true });
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch (error) {
    throw new CodexMetadataFailure(`invalid first session record at ${file}`, { cause: error });
  }
  if (!isObject(record) || record["type"] !== "session_meta" || !isObject(record["payload"])) {
    throw new CodexMetadataFailure(`missing first session_meta record at ${file}`);
  }
  const payload = record["payload"];
  const id = requiredString(payload, "id");
  if (!CODEX_UUID_PATTERN.test(id)) throw new CodexMetadataFailure(`invalid native session UUID at ${file}`);
  const source = payload["source"];
  const threadSpawn = nativeThreadSpawn(source);
  return {
    id, cwd: requiredString(payload, "cwd"), source, threadSpawn,
    parentThreadId: agreeingField(payload, threadSpawn, "parent_thread_id"),
    agentPath: agreeingField(payload, threadSpawn, "agent_path"),
    agentRole: agreeingField(payload, threadSpawn, "agent_role"),
  };
}

export function readBoundedRegularFile(options: Readonly<{
  file: string; deadline: number; maxBytes: number; firstRecord: boolean;
}>): Readonly<{ text: string; stat: Stats }> {
  const { file, deadline } = options;
  requireMetadataTime(deadline);
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new CodexMetadataFailure(`not a regular non-symlink file: ${file}`);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    requireSameFile(before, opened, file);
    const text = boundedText(fd, options);
    requireMetadataTime(deadline);
    requireSameFile(opened, fstatSync(fd), file);
    requireSameFile(opened, lstatSync(file), file);
    return { text, stat: opened };
  } finally { closeSync(fd); }
}

export function requireMetadataTime(deadline: number): void {
  if (performance.now() >= deadline) throw new CodexMetadataFailure("Codex metadata readiness exceeded 10 seconds");
}

function boundedText(fd: number, options: Readonly<{ file: string; deadline: number; maxBytes: number; firstRecord: boolean }>): string {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= options.maxBytes) {
    requireMetadataTime(options.deadline);
    const chunk = Buffer.alloc(Math.min(4096, options.maxBytes + 1 - total));
    const count = readSync(fd, chunk, 0, chunk.length, null);
    if (count === 0) {
      if (options.firstRecord) throw new CodexMetadataFailure(`unterminated first record at ${options.file}`);
      return Buffer.concat(chunks).toString("utf8");
    }
    const newline = options.firstRecord ? chunk.subarray(0, count).indexOf(10) : -1;
    const used = newline === -1 ? count : newline + 1;
    total += used;
    if (total > options.maxBytes) break;
    chunks.push(chunk.subarray(0, used));
    if (newline !== -1) return Buffer.concat(chunks).toString("utf8");
  }
  throw new CodexMetadataFailure(`file record exceeds ${options.maxBytes} bytes: ${options.file}`);
}

function requireSameFile(before: Stats, after: Stats, file: string): void {
  if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
    throw new CodexMetadataFailure(`file identity changed while reading ${file}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nativeThreadSpawn(source: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!isObject(source) || !("subagent" in source)) return undefined;
  const subagent = source["subagent"];
  if (!isObject(subagent) || !isObject(subagent["thread_spawn"])) {
    throw new CodexMetadataFailure("unrecognized native subagent provenance");
  }
  return subagent["thread_spawn"];
}

function requiredString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value === "") throw new CodexMetadataFailure(`missing or invalid native ${key}`);
  return value;
}

function agreeingField(direct: Readonly<Record<string, unknown>>, nested: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const outer = key in direct ? requiredString(direct, key) : undefined;
  const inner = nested !== undefined && key in nested ? requiredString(nested, key) : undefined;
  if (outer !== undefined && inner !== undefined && outer !== inner) throw new CodexMetadataFailure(`contradictory native ${key}`);
  return outer ?? inner;
}
