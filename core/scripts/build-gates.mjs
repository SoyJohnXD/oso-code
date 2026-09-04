import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleText, checkFreshArtifacts, importBundled, runBuildCli, writeArtifacts } from "./lib/bundle.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const renderModule = join(repoRoot, "core", "src", "routes", "render.ts");
const hashFile = join(repoRoot, "bootstrap", "hook-hashes.txt");
const publishedRow = /^([0-9a-f]{64})( {2})(\S.*)$/;

const OPENCODE_HOST_PACKAGE = "@opencode-ai/plugin";

function bundlesOf(render) {
  const spawned = [
    { source: "gate.ts", bundle: render.GATE_BUNDLE },
    { source: "precommit.ts", bundle: render.PRECOMMIT_BUNDLE },
  ].map(({ source, bundle }) => ({
    entryPoint: join(repoRoot, "core", "src", "bin", source),
    path: join(repoRoot, "plugin", render.BUNDLE_DIRECTORY, bundle),
    name: `plugin/${render.BUNDLE_DIRECTORY}/${bundle}`,
    external: [],
  }));
  return [
    ...spawned,
    {
      entryPoint: join(repoRoot, ...render.OPENCODE_PLUGIN_ENTRY.split("/")),
      path: join(repoRoot, ...render.OPENCODE_PLUGIN_BUNDLE.split("/")),
      name: render.OPENCODE_PLUGIN_BUNDLE,
      external: [OPENCODE_HOST_PACKAGE],
    },
  ];
}

function manifestsOf(render) {
  return render.MANIFEST_HOSTS.map((host) => ({
    path: join(repoRoot, render.manifestPathOf(host)),
    name: render.manifestPathOf(host),
    text: render.renderHooksManifest(host),
  }));
}

function redigestedHashFile(writtenSoFar) {
  const overriding = new Map(writtenSoFar.map((artifact) => [artifact.name, artifact.text]));
  const lines = readFileSync(hashFile, "utf8").split("\n");
  const redigested = lines.map((line) => {
    const row = publishedRow.exec(line);
    if (row === null) return line;
    const [, , separator, file] = row;
    const published = overriding.get(file) ?? readFileSync(join(repoRoot, file), "utf8");
    return `${createHash("sha256").update(published).digest("hex")}${separator}${file}`;
  });
  return { path: hashFile, name: "bootstrap/hook-hashes.txt", text: redigested.join("\n") };
}

async function freshArtifacts() {
  const render = await importBundled(renderModule);
  const built = await Promise.all(
    bundlesOf(render).map(async ({ entryPoint, path, name, external }) => ({
      path,
      name,
      text: await bundleText(entryPoint, external),
    })),
  );
  const artifacts = [...built, ...manifestsOf(render)];
  return [...artifacts, redigestedHashFile(artifacts)];
}

async function check() {
  checkFreshArtifacts("gates", "core/src", await freshArtifacts());
}

async function write() {
  writeArtifacts(await freshArtifacts());
}

await runBuildCli({ check, write });
