import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFreshArtifacts, importBundled, readTextOrNull, runBuildCli, writeArtifacts } from "./lib/bundle.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const renderModule = join(repoRoot, "core", "src", "prose", "render.ts");

function agentArtifacts(prose) {
  return prose.AGENT_ROLES.flatMap((role) => prose.agentHosts(role).map((host) => agentArtifact(prose, role, host)));
}

function agentArtifact(prose, role, host) {
  const sharedBody = readFileSync(join(repoRoot, prose.agentSharedBodyPath(role)), "utf8");
  const delta = readTextOrNull(join(repoRoot, prose.agentBodyPath(role, host)));
  return artifactOf(prose.agentOutputPath(role, host), prose.renderAgent(role, host, sharedBody, delta));
}

function skillArtifacts(prose) {
  return prose.SKILL_STUBS.flatMap((stub) => prose.SHARED_REFERENCE_HOSTS.map((host) => skillArtifact(prose, stub, host)));
}

function skillArtifact(prose, stub, host) {
  const body = readFileSync(join(repoRoot, prose.skillBodyPath(stub, host)), "utf8");
  const flow = readFileSync(join(repoRoot, prose.skillFlowPath(stub)), "utf8");
  return artifactOf(prose.skillOutputPath(stub, host), prose.renderSkill(stub, host, body, flow));
}

function skillReferenceArtifacts(prose) {
  return prose.SKILL_STUBS.flatMap((stub) => stub.referenceHosts.map((host) => skillReferenceArtifact(prose, stub, host)));
}

function skillReferenceArtifact(prose, stub, host) {
  const body = readFileSync(join(repoRoot, prose.skillReferencePath(stub, host)), "utf8");
  return artifactOf(prose.skillReferenceOutputPath(stub, host), prose.renderReference(body));
}

function sharedReferenceArtifacts(prose) {
  return prose.SHARED_REFERENCE_HOSTS.map((host) => sharedReferenceArtifact(prose, host));
}

function sharedReferenceArtifact(prose, host) {
  const body = readFileSync(join(repoRoot, prose.sharedReferencePath(host)), "utf8");
  return artifactOf(prose.sharedReferenceOutputPath(host), prose.renderReference(body));
}

function artifactOf(name, text) {
  return { path: join(repoRoot, name), name, text };
}

async function freshArtifacts() {
  const prose = await importBundled(renderModule);
  return [...agentArtifacts(prose), ...skillArtifacts(prose), ...skillReferenceArtifacts(prose), ...sharedReferenceArtifacts(prose)];
}

async function check() {
  checkFreshArtifacts("prose", "core/src/prose", await freshArtifacts());
}

async function write() {
  writeArtifacts(await freshArtifacts());
}

await runBuildCli({ check, write });
