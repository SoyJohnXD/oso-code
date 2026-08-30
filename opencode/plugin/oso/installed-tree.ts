import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function stateBinPath(): string {
  const explicit = process.env.OSO_STATE_BIN;
  if (explicit !== undefined && explicit !== "") {
    return explicit;
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "oso-state");
}
