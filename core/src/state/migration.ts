import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import {
  causeOf,
  isDirectory,
  logEvent,
  readStateFile,
  sha256Hex,
  StateFileUnreadableError,
  stateLeftAtTheInferredIdentity,
  stateRootDirectory,
  taskIdentityFor,
  withLock,
  withOwnerOnlyUmask,
  writeFileAtomically,
  type InferredState,
  type NamedTaskIdentity,
  type StateFileRead,
} from "./store.ts";

export class TaskStateMigrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TaskStateMigrationError";
  }
}

type ArtifactCollision = "refuse" | "concatenate";

type CarriedArtifact = Readonly<{ from: string; to: string; onCollision: ArtifactCollision }>;

const PLANS_TREE = "plans";
const KEYED_FILES = ["deploy-deny/{key}.patterns", "profiles/{key}.profile"] as const;
const KEYED_TREES = ["runs", PLANS_TREE, ".handoffs"] as const;
const RESUME_TRIGGERING_STATE_FILE = "{key}.state";
const PLAN_PATH_KEYS = ["plan_snapshot_file", "plan_current_file"] as const;
const JOURNAL_SUFFIX = ".log";

export function migrateInferredTaskState(cwd: string, session: string): void {
  const task = taskIdentityFor(cwd);
  if (task.kind !== "declared") return;
  const left = stateLeftAtTheInferredIdentity(cwd, task);
  if (left === undefined) return;
  withLock(left.stateFile, session, () => {
    if (readStateFile(left.stateFile).kind === "absent") return;
    if (readStateFile(task.stateFile).kind !== "absent") {
      throw new TaskStateMigrationError(twoIdentitiesHoldState(cwd, left, task));
    }
    carryEverythingKeyedBy(left.identity, task, session);
  });
}

function carryEverythingKeyedBy(inferred: string, task: NamedTaskIdentity, session: string): void {
  const inferredKey = sha256Hex(inferred);
  const declaredKey = sha256Hex(task.identity);
  const carried = plannedCarries(inferredKey, declaredKey);
  const colliding = carried.filter((artifact) => artifact.onCollision === "refuse" && existsSync(artifact.to));
  if (colliding.length > 0) throw new TaskStateMigrationError(artifactsCollide(inferred, task.identity, colliding));
  try {
    for (const artifact of carried) carryOne(artifact, inferred);
    for (const tree of KEYED_TREES) rmSync(treeOf(tree, inferredKey), { recursive: true, force: true });
    carryStateFileLastSoAnInterruptionResumes(inferredKey, declaredKey);
  } catch (error) {
    if (error instanceof TaskStateMigrationError) throw error;
    throw new TaskStateMigrationError(carryStoppedPartway(inferred, task.identity, causeOf(error)), { cause: error });
  }
  logEvent({ event: "identity-migrated", session, command: `${inferred} -> ${task.identity}` });
}

function plannedCarries(from: string, to: string): readonly CarriedArtifact[] {
  const files = KEYED_FILES.map((template) => ({
    from: artifactPath(template, from),
    to: artifactPath(template, to),
    onCollision: "refuse" as const,
  }));
  return [...files, ...KEYED_TREES.flatMap((tree) => treeCarries(tree, from, to))].filter((artifact) =>
    existsSync(artifact.from),
  );
}

function treeCarries(tree: string, from: string, to: string): CarriedArtifact[] {
  const source = treeOf(tree, from);
  const destination = treeOf(tree, to);
  return entryNamesOf(source).map((name) => ({
    from: path.join(source, name),
    to: path.join(destination, name),
    onCollision: name.endsWith(JOURNAL_SUFFIX) ? "concatenate" : "refuse",
  }));
}

function carryOne(artifact: CarriedArtifact, inferred: string): void {
  mkdirSync(path.dirname(artifact.to), { recursive: true, mode: 0o700 });
  if (artifact.onCollision === "concatenate" && existsSync(artifact.to)) {
    withOwnerOnlyUmask(() => appendFileSync(artifact.to, journalLinesCarriedFrom(artifact.from, inferred)));
    rmSync(artifact.from, { force: true });
    return;
  }
  renameSync(artifact.from, artifact.to);
}

function carryStateFileLastSoAnInterruptionResumes(inferredKey: string, declaredKey: string): void {
  const legacyStateFile = artifactPath(RESUME_TRIGGERING_STATE_FILE, inferredKey);
  retargetCarriedPlanPaths(legacyStateFile, inferredKey, declaredKey);
  renameSync(legacyStateFile, artifactPath(RESUME_TRIGGERING_STATE_FILE, declaredKey));
}

function retargetCarriedPlanPaths(stateFile: string, inferredKey: string, declaredKey: string): void {
  const read = readStateFile(stateFile);
  if (read.kind !== "ok") throw new StateFileUnreadableError(stateFile, readFailureCause(read));
  const planDirectory = treeOf(PLANS_TREE, inferredKey);
  const carriedPlanDirectory = treeOf(PLANS_TREE, declaredKey);
  const retargeted = read.content
    .split("\n")
    .map((line) => planLineRebasedOn(line, planDirectory, carriedPlanDirectory))
    .join("\n");
  if (retargeted !== read.content) writeFileAtomically(path.dirname(stateFile), stateFile, retargeted, ".retarget.");
}

function planLineRebasedOn(line: string, planDirectory: string, carriedPlanDirectory: string): string {
  const key = PLAN_PATH_KEYS.find((named) => line.startsWith(`${named}=`));
  if (key === undefined) return line;
  const recorded = line.slice(key.length + 1);
  if (path.dirname(recorded) !== planDirectory) return line;
  return `${key}=${path.join(carriedPlanDirectory, path.basename(recorded))}`;
}

function journalLinesCarriedFrom(journal: string, inferred: string): string {
  return readFileSync(journal, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => `${line} [carried from ${inferred}]\n`)
    .join("");
}

function twoIdentitiesHoldState(cwd: string, left: InferredState, task: NamedTaskIdentity): string {
  return (
    `two task identities hold state for ${cwd}, and this harness never merges them: a merged state can open a ` +
    `red repository's commit gate on a neighbour's green. Keep the one this task should use, remove the other, ` +
    `then run again.\n${whatItHolds(task.identity, task.stateFile)}${whatItHolds(left.identity, left.stateFile)}`
  );
}

function whatItHolds(identity: string, stateFile: string): string {
  const read = readStateFile(stateFile);
  const held =
    read.kind === "ok"
      ? read.content.split("\n").filter((line) => line !== "")
      : [`this file cannot be read: ${readFailureCause(read)}`];
  return [`  ${identity} (${stateFile})`, ...held.map((line) => `    ${line}`), ""].join("\n");
}

function readFailureCause(read: StateFileRead): string {
  return read.kind === "unreadable" ? read.cause : "it is absent";
}

function artifactsCollide(inferred: string, identity: string, colliding: readonly CarriedArtifact[]): string {
  return (
    `the state of ${inferred} cannot be carried to ${identity}: ${colliding.length} artifact(s) already stand ` +
    `under the declared identity, and each of them is keyed to one agent or one plan, so choosing between the ` +
    `two would be a guess. Remove whichever is spent, then run again.\n` +
    colliding.map((artifact) => `  ${artifact.to}\n`).join("")
  );
}

function carryStoppedPartway(inferred: string, identity: string, cause: string): string {
  return (
    `the state of ${inferred} stopped partway on its way to ${identity}: ${cause}. Nothing was dropped and the ` +
    `state still answers at ${inferred}, so the gates keep denying rather than allowing on state they no longer ` +
    `read. Clear whatever blocked the carry and the next oso-state run finishes it.`
  );
}

function treeOf(tree: string, key: string): string {
  return artifactPath(`${tree}/{key}`, key);
}

function artifactPath(template: string, key: string): string {
  return path.join(stateRootDirectory(), ...template.replace("{key}", key).split("/"));
}

function entryNamesOf(directory: string): string[] {
  return isDirectory(directory) ? readdirSync(directory) : [];
}
