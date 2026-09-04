import { readFileSync } from "node:fs";
import path from "node:path";
import { isReadableRegularFile, writeFileAtomically } from "../state/store.ts";

export class JsonParseError extends Error {
  readonly file: string;
  constructor(file: string, cause: unknown) {
    super(`cannot parse JSON at ${file}`, { cause });
    this.name = "JsonParseError";
    this.file = file;
  }
}

export function readJsonFile(file: string): unknown | undefined {
  if (!isReadableRegularFile(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    throw new JsonParseError(file, cause);
  }
}

export function readJsonObject(file: string): Record<string, unknown> {
  const value = readJsonFile(file);
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new JsonParseError(file, new Error("top-level value is not a JSON object"));
  }
  return value as Record<string, unknown>;
}

export function writeJsonFile(file: string, value: unknown): void {
  writeFileAtomically(path.dirname(file), file, `${JSON.stringify(value, null, 2)}\n`, ".oso-json-");
}
