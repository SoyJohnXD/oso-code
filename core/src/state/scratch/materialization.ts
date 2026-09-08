import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statfsSync } from "node:fs";
import path from "node:path";
import { sha256Hex } from "../store.ts";

export type ScratchRecipe = Readonly<{
  version: 1;
  foreground: true;
  cacheRouting: "node-only" | "node-npm";
  tools?: readonly string[];
  source: readonly string[];
  dependencies: readonly string[];
  exclusions: readonly string[];
  headroomBytes: number;
  headroomInodes: number;
  commands: readonly Readonly<{ purpose: "setup" | "check" | "certification"; argv: readonly string[] }>[];
}>;

export type InventoryEntry = Readonly<{ name: string; kind: "file" | "directory"; bytes: number; digest: string; dependency: boolean }>;

export function readRecipe(sourceRoot: string, recipePath: string): ScratchRecipe {
  const file = safeRelativePath(sourceRoot, recipePath);
  assertCanonicalPath(file);
  const recipe = JSON.parse(readFileSync(file, "utf8")) as ScratchRecipe;
  if (recipe.version !== 1 || recipe.foreground !== true || !["node-only", "node-npm"].includes(recipe.cacheRouting)) {
    throw new Error("scratch requires an explicitly reviewed foreground recipe; unknown cache routing refused");
  }
  if (![recipe.source, recipe.dependencies, recipe.exclusions].every((list) => Array.isArray(list) && list.every((entry) => typeof entry === "string"))) {
    throw new Error("scratch recipe requires explicit source/dependency/exclusion inventory");
  }
  for (const amount of [recipe.headroomBytes, recipe.headroomInodes]) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("scratch capacity estimate unavailable; declare build headroom");
  }
  if (!Array.isArray(recipe.commands) || recipe.commands.length === 0 || recipe.commands.some((command) =>
    !["setup", "check", "certification"].includes(command.purpose) || !Array.isArray(command.argv) || command.argv.length === 0 ||
    command.argv.some((token: unknown) => typeof token !== "string" || token.includes("\0") || /[\r\n]/.test(token)))) {
    throw new Error("scratch requires literal argv for each reviewed foreground command");
  }
  for (const name of [...recipe.source, ...recipe.dependencies, ...recipe.exclusions]) safeRelativePath(sourceRoot, name);
  return recipe;
}

export function inventoryFor(sourceRoot: string, recipe: ScratchRecipe): InventoryEntry[] {
  const inventory: InventoryEntry[] = [];
  const seen = new Set<string>();
  for (const [names, dependency] of [[recipe.source, false], [recipe.dependencies, true]] as const) {
    for (const name of names) visit(name, dependency);
  }
  return inventory.sort((left, right) => left.name.localeCompare(right.name));

  function visit(name: string, dependency: boolean): void {
    if (recipe.exclusions.some((excluded) => name === excluded || name.startsWith(`${excluded}/`))) return;
    if (sensitivePath(name)) throw new Error(`scratch sensitive path refused: ${name}`);
    if (seen.has(name.toLowerCase())) throw new Error(`scratch duplicate or case alias inventory: ${name}`);
    seen.add(name.toLowerCase());
    const source = safeRelativePath(sourceRoot, name);
    assertCanonicalPath(source);
    const stat = lstatSync(source);
    if (!stat.isFile() && !stat.isDirectory()) throw new Error(`scratch links and special files refused: ${name}`);
    if (stat.isFile() && stat.nlink !== 1) throw new Error(`scratch source hardlink refused: ${name}`);
    inventory.push({ name, kind: stat.isDirectory() ? "directory" : "file", bytes: stat.isFile() ? stat.size : 0,
      digest: stat.isFile() ? sha256Hex(readFileSync(source)) : "", dependency });
    if (stat.isDirectory()) for (const child of readdirSync(source).sort()) visit(`${name}/${child}`, dependency);
  }
}

export function admitCapacity(root: string, requested: Readonly<{ bytes: number; inodes: number }>, reserved: Readonly<{ bytes: number; inodes: number }>): void {
  const reserveBytes = 2 * 1024 * 1024 * 1024;
  const reserveInodes = 100000;
  const available = statfsSync(root, { bigint: true });
  if (available.files === 0n && available.ffree === 0n) throw new Error("scratch inode capacity unavailable (including Btrfs 0/0)");
  if (available.bavail * available.bsize < BigInt(requested.bytes) + BigInt(reserved.bytes) + BigInt(reserveBytes) ||
      available.ffree < BigInt(requested.inodes) + BigInt(reserved.inodes) + BigInt(reserveInodes)) {
    throw new Error("scratch capacity refused: retain 2 GiB and 100000 free inodes after concurrent reservations");
  }
}

export function copyInventory(sourceRoot: string, destination: string, inventory: readonly InventoryEntry[]): void {
  for (const entry of inventory) {
    const source = safeRelativePath(sourceRoot, entry.name);
    const target = safeRelativePath(destination, entry.name);
    assertCanonicalPath(source);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    assertCanonicalPath(path.dirname(target));
    if (entry.kind === "directory") mkdirSync(target, { mode: 0o700 });
    else {
      copyFileSync(source, target);
      if (sha256Hex(readFileSync(target)) !== entry.digest) throw new Error(`scratch source changed during copy: ${entry.name}`);
    }
  }
}

export function assertCanonicalPath(target: string): void {
  const absolute = path.resolve(target);
  if (sensitivePath(absolute)) throw new Error(`scratch sensitive path refused: ${absolute}`);
  let cursor = path.parse(absolute).root;
  for (const component of absolute.slice(cursor.length).split(path.sep)) {
    cursor = path.join(cursor, component);
    if (lstatSync(cursor).isSymbolicLink() || realpathSync(cursor) !== cursor) {
      throw new Error(`scratch link/reparse/junction/case alias refused: ${cursor}`);
    }
  }
}

function safeRelativePath(root: string, name: string): string {
  if (name === "" || name.includes("\\") || /[\0\r\n]/.test(name) || name.split("/").some((part) => part === "." || part === ".." || part === "")) {
    throw new Error(`scratch unsafe relative path: ${name}`);
  }
  const target = path.resolve(root, name);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`scratch path escapes root: ${name}`);
  return target;
}

function sensitivePath(name: string): boolean {
  return name.split("/").some((part) => /^(?:\.git|\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.kube|\.npmrc|secrets|id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?|gcloud)$/i.test(part) || /\.(?:key|pem|p12|pfx|jks|keystore)$/i.test(part));
}
