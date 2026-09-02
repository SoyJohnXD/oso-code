import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importBundled, readTextOrNull } from "./lib/bundle.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const renderModule = join(repoRoot, "core", "src", "prose", "render.ts");
const SKILL_HOSTS = ["codex", "opencode"];

function agentArtifacts(prose) {
  return prose.AGENT_ROLES.flatMap((role) => prose.agentHosts(role).map((host) => agentArtifact(prose, role, host)));
}

function agentArtifact(prose, role, host) {
  const body = readFileSync(join(repoRoot, prose.agentBodyPath(role, host)), "utf8");
  return artifactOf(prose.agentOutputPath(role, host), prose.renderAgent(role, host, body));
}

function skillArtifacts(prose) {
  return prose.SKILL_STUBS.flatMap((stub) => SKILL_HOSTS.map((host) => skillArtifact(prose, stub, host)));
}

function skillArtifact(prose, stub, host) {
  const body = readFileSync(join(repoRoot, prose.skillBodyPath(stub, host)), "utf8");
  return artifactOf(prose.skillOutputPath(stub, host), prose.renderSkill(stub, host, body));
}

function artifactOf(name, text) {
  return { path: join(repoRoot, name), name, text };
}

async function freshArtifacts() {
  const prose = await importBundled(renderModule);
  return [...agentArtifacts(prose), ...skillArtifacts(prose)];
}

async function check() {
  let stale = 0;
  for (const artifact of await freshArtifacts()) {
    if (readTextOrNull(artifact.path) === artifact.text) continue;
    process.stderr.write(`prose: ${artifact.name} is stale against core/src/prose — run npm run build\n`);
    stale += 1;
  }
  process.exitCode = stale === 0 ? 0 : 1;
}

async function write() {
  for (const artifact of await freshArtifacts()) {
    mkdirSync(dirname(artifact.path), { recursive: true });
    writeFileSync(artifact.path, artifact.text);
  }
}

if (process.argv.includes("--check")) {
  await check();
} else {
  await write();
}
