import { statSync } from "node:fs";

export function isExecutableRegularFile(path, options = {}) {
  const platform = options.platform ?? process.platform;
  const statFn = options.statSync ?? statSync;
  let stats;
  try {
    stats = statFn(path);
  } catch {
    return false;
  }
  if (!stats.isFile()) return false;
  if (platform === "win32") return true;
  return (stats.mode & 0o777) === 0o755;
}
