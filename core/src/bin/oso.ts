import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../install/cli.ts";
import { isDirectory } from "../state/store.ts";

const REPOSITORY_ROOT_MARKERS = ["core", "bootstrap"] as const;

export function repositoryRootFrom(startDirectory: string): string {
  let candidate = startDirectory;
  while (!REPOSITORY_ROOT_MARKERS.every((marker) => isDirectory(join(candidate, marker)))) {
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error(`cannot locate the repository root above ${startDirectory}`);
    candidate = parent;
  }
  return candidate;
}

const repositoryRoot = repositoryRootFrom(dirname(fileURLToPath(import.meta.url)));

process.exit(main(process.argv.slice(2), repositoryRoot));
