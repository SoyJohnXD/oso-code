import type { Stats } from "node:fs";

export interface IsExecutableRegularFileOptions {
  readonly platform?: NodeJS.Platform;
  readonly statSync?: (path: string) => Stats;
}

export function isExecutableRegularFile(path: string, options?: IsExecutableRegularFileOptions): boolean;
