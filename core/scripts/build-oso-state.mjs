import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleText, importBundled, readTextOrNull, runBuildCli } from "./lib/bundle.mjs";
import { isExecutableRegularFile } from "./lib/executable-file.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const entryPoint = join(repoRoot, "core/src/bin/oso-state.ts");
const routesModule = join(repoRoot, "core/src/routes/routes.ts");
const {
  MODULE_MANIFEST,
  PLUGIN_BUNDLE_DIRECTORY,
  PLUGIN_BINARY_DIRECTORY,
  PLUGIN_STATE_BUNDLE,
  PLUGIN_STATE_EXECUTABLE,
} = await importBundled(routesModule);
const distOutfile = join(repoRoot, PLUGIN_STATE_BUNDLE);
const distPackageJson = join(repoRoot, PLUGIN_BUNDLE_DIRECTORY, MODULE_MANIFEST);
const binOutfile = join(repoRoot, PLUGIN_STATE_EXECUTABLE);
const binPackageJson = join(repoRoot, PLUGIN_BINARY_DIRECTORY, MODULE_MANIFEST);
const binMode = 0o755;
const shebang = "#!/usr/bin/env node\n";
const modulePackageJson = '{\n  "private": true,\n  "type": "module"\n}\n';

async function check() {
  const freshDist = await bundleText(entryPoint);
  const freshBin = shebang + freshDist;
  let ok = true;
  if (readTextOrNull(distOutfile) !== freshDist) {
    process.stderr.write(
      "oso-state: plugin/dist/oso-state.js is stale against core/src/bin/oso-state.ts — run npm run build\n",
    );
    ok = false;
  }
  if (readTextOrNull(binOutfile) !== freshBin) {
    process.stderr.write(
      "oso-state: plugin/bin/oso-state is stale against core/src/bin/oso-state.ts — run npm run build\n",
    );
    ok = false;
  } else if (!isExecutableRegularFile(binOutfile)) {
    process.stderr.write("oso-state: plugin/bin/oso-state is not executable — run npm run build\n");
    ok = false;
  }
  if (readTextOrNull(distPackageJson) !== modulePackageJson) {
    process.stderr.write("oso-state: plugin/dist/package.json is stale — run npm run build\n");
    ok = false;
  }
  if (readTextOrNull(binPackageJson) !== modulePackageJson) {
    process.stderr.write("oso-state: plugin/bin/package.json is stale — run npm run build\n");
    ok = false;
  }
  process.exitCode = ok ? 0 : 1;
}

async function writeBundle() {
  const fresh = await bundleText(entryPoint);
  mkdirSync(dirname(distOutfile), { recursive: true });
  writeFileSync(distOutfile, fresh);
  writeFileSync(distPackageJson, modulePackageJson);
  mkdirSync(dirname(binOutfile), { recursive: true });
  writeFileSync(binOutfile, shebang + fresh);
  chmodSync(binOutfile, binMode);
  writeFileSync(binPackageJson, modulePackageJson);
}

await runBuildCli({ check, write: writeBundle });
