import { readFileSync } from "node:fs";
import { parse as parseTomlText, TomlError } from "smol-toml";
import { isReadableRegularFile } from "../state/store.ts";

export class TomlParseError extends Error {
  readonly file: string;
  constructor(file: string, cause: unknown) {
    super(`cannot parse TOML at ${file}`, { cause });
    this.name = "TomlParseError";
    this.file = file;
  }
}

export function parseTomlDocument(text: string, file: string): Record<string, unknown> {
  try {
    return parseTomlText(text) as Record<string, unknown>;
  } catch (cause) {
    if (cause instanceof TomlError) throw new TomlParseError(file, cause);
    throw cause;
  }
}

export function readTomlFile(file: string): Record<string, unknown> | undefined {
  if (!isReadableRegularFile(file)) return undefined;
  return parseTomlDocument(readFileSync(file, "utf8"), file);
}
