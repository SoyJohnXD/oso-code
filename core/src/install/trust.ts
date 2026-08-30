import { readFileSync } from "node:fs";
import { isReadableRegularFile, sha256Hex } from "../state/store.ts";

export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const ROW_PATTERN = /^(\S+)\s+(.*)$/;

export type TrustRow = Readonly<{ digest: string; file: string }>;

export type TrustDivergenceState =
  | { kind: "missing-manifest" }
  | { kind: "malformed-published-hash" }
  | { kind: "outside-the-trust-set" }
  | { kind: "missing" }
  | { kind: "mismatch"; actual: string };

export type TrustDivergence = Readonly<{ file: string; state: TrustDivergenceState }>;

export function parseTrustManifest(text: string): TrustRow[] {
  return text
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const row = ROW_PATTERN.exec(line);
      return row === null ? { digest: line, file: "" } : { digest: row[1] as string, file: row[2] as string };
    });
}

export function trustDivergences(
  manifestFile: string,
  isExcluded: (relative: string) => boolean,
  resolveTarget: (relative: string) => string | undefined,
): TrustDivergence[] {
  if (!isReadableRegularFile(manifestFile)) return [{ file: manifestFile, state: { kind: "missing-manifest" } }];
  const trusted = parseTrustManifest(readFileSync(manifestFile, "utf8")).filter((row) => !isExcluded(row.file));
  return trusted.flatMap((row) => divergenceOf(row, resolveTarget));
}

function divergenceOf(row: TrustRow, resolveTarget: (relative: string) => string | undefined): TrustDivergence[] {
  if (!SHA256_HEX_PATTERN.test(row.digest)) return [{ file: row.file, state: { kind: "malformed-published-hash" } }];
  const target = resolveTarget(row.file);
  if (target === undefined) return [{ file: row.file, state: { kind: "outside-the-trust-set" } }];
  if (!isReadableRegularFile(target)) return [{ file: row.file, state: { kind: "missing" } }];
  const actual = sha256Hex(readFileSync(target));
  return actual === row.digest ? [] : [{ file: row.file, state: { kind: "mismatch", actual } }];
}
