import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export async function bundleText(entryPoint, external = []) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "node",
    format: "esm",
    external,
    write: false,
  });
  return result.outputFiles[0].text;
}

export async function importBundled(entryPoint) {
  const text = await bundleText(entryPoint);
  return import(`data:text/javascript;base64,${Buffer.from(text, "utf8").toString("base64")}`);
}

export function readTextOrNull(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function checkFreshArtifacts(component, against, artifacts) {
  let stale = 0;
  for (const artifact of artifacts) {
    if (readTextOrNull(artifact.path) === artifact.text) continue;
    process.stderr.write(`${component}: ${artifact.name} is stale against ${against} — run npm run build\n`);
    stale += 1;
  }
  process.exitCode = stale === 0 ? 0 : 1;
}

export function writeArtifacts(artifacts) {
  for (const artifact of artifacts) {
    mkdirSync(dirname(artifact.path), { recursive: true });
    writeFileSync(artifact.path, artifact.text);
  }
}

export async function runBuildCli({ check, write }) {
  if (process.argv.includes("--check")) {
    await check();
  } else {
    await write();
  }
}
