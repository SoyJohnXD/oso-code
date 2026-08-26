import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const entryPoint = join(repoRoot, "core", "src", "bin", "oso-state.ts");
const outfile = join(repoRoot, "plugin", "dist", "oso-state.js");

async function freshBundleText() {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  return result.outputFiles[0].text;
}

async function check() {
  const fresh = await freshBundleText();
  let committed;
  try {
    committed = readFileSync(outfile, "utf8");
  } catch {
    committed = null;
  }
  if (committed !== fresh) {
    process.stderr.write(
      "oso-state: plugin/dist/oso-state.js is stale against core/src/bin/oso-state.ts — run npm run build\n",
    );
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

async function writeBundle() {
  const fresh = await freshBundleText();
  mkdirSync(dirname(outfile), { recursive: true });
  writeFileSync(outfile, fresh);
}

if (process.argv.includes("--check")) {
  await check();
} else {
  await writeBundle();
}
