import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleText, readTextOrNull, runBuildCli } from "./lib/bundle.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const entryPoint = join(repoRoot, "core", "src", "bin", "oso.ts");
const outfile = join(repoRoot, "bootstrap", "oso.js");
const outfilePackageJson = join(repoRoot, "bootstrap", "package.json");
const modulePackageJson = '{\n  "private": true,\n  "type": "module"\n}\n';

async function check() {
  const fresh = await bundleText(entryPoint);
  let ok = true;
  if (readTextOrNull(outfile) !== fresh) {
    process.stderr.write("oso: bootstrap/oso.js is stale against core/src/bin/oso.ts — run npm run build\n");
    ok = false;
  }
  if (readTextOrNull(outfilePackageJson) !== modulePackageJson) {
    process.stderr.write("oso: bootstrap/package.json is stale — run npm run build\n");
    ok = false;
  }
  process.exitCode = ok ? 0 : 1;
}

async function writeBundle() {
  const fresh = await bundleText(entryPoint);
  mkdirSync(dirname(outfile), { recursive: true });
  writeFileSync(outfile, fresh);
  writeFileSync(outfilePackageJson, modulePackageJson);
}

await runBuildCli({ check, write: writeBundle });
