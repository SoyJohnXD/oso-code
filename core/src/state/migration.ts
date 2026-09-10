import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import {
  causeOf,
  isDirectory,
  KEYED_ARTIFACT_FILES,
  KEYED_ARTIFACT_TREES,
  logEvent,
  planDirectoryKeyedBy,
  readStateFile,
  sha256Hex,
  StateFileUnreadableError,
  stateKeyedByAnotherTaskIdentity,
  taskArtifactsStandAt,
  taskIdentityFor,
  withLock,
  withOwnerOnlyUmask,
  writeFileAtomically,
  type ArtifactKeyedByRepository,
  type StateAtAnotherIdentity,
  type NamedTaskIdentity,
  type StateFileRead,
} from "./store.ts";

class TaskStateMigrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TaskStateMigrationError";
  }
}

type ArtifactCollision = "refuse" | "concatenate";

type CarriedArtifact = Readonly<{ from: string; to: string; onCollision: ArtifactCollision }>;

type CarriedIdentity = Readonly<{ identity: string; key: string; stateFile: string }>;

const PLAN_PATH_KEYS = ["plan_snapshot_file", "plan_current_file"] as const;
const JOURNAL_SUFFIX = ".log";

export function migrateInferredTaskState(cwd: string, session: string): void {
  const task = taskIdentityFor(cwd);
  if (task.kind !== "declared") return;
  const left = stateKeyedByAnotherTaskIdentity(cwd, task);
  if (left === undefined) return;
  withLock(left.stateFile, session, () => {
    if (!taskArtifactsStandAt(left)) return;
    if (readStateFile(left.stateFile).kind !== "absent" && readStateFile(task.stateFile).kind !== "absent") {
      throw new TaskStateMigrationError(twoIdentitiesHoldState(cwd, left, task));
    }
    carryEverythingKeyedBy(keyedIdentity(left), keyedIdentity(task), session);
  });
}

function keyedIdentity({ identity, stateFile }: Readonly<{ identity: string; stateFile: string }>): CarriedIdentity {
  return { identity, key: sha256Hex(identity), stateFile };
}

function carryEverythingKeyedBy(inferred: CarriedIdentity, declared: CarriedIdentity, session: string): void {
  const carried = plannedCarries(inferred.key, declared.key);
  const colliding = carried.filter((artifact) => artifact.onCollision === "refuse" && existsSync(artifact.to));
  if (colliding.length > 0) {
    throw new TaskStateMigrationError(artifactsCollide(inferred.identity, declared.identity, colliding));
  }
  try {
    for (const artifact of carried) carryOne(artifact, inferred.identity);
    for (const treeKeyedBy of KEYED_ARTIFACT_TREES) rmSync(treeKeyedBy(inferred.key), { recursive: true, force: true });
    carryStateFileLastSoAnInterruptionResumes(inferred, declared);
  } catch (error) {
    if (error instanceof TaskStateMigrationError) throw error;
    throw new TaskStateMigrationError(carryStoppedPartway(inferred.identity, declared.identity, causeOf(error)), {
      cause: error,
    });
  }
  logEvent({ event: "identity-migrated", session, command: `${inferred.identity} -> ${declared.identity}` });
}

function plannedCarries(from: string, to: string): readonly CarriedArtifact[] {
  const files = KEYED_ARTIFACT_FILES.map((fileKeyedBy) => ({
    from: fileKeyedBy(from),
    to: fileKeyedBy(to),
    onCollision: "refuse" as const,
  }));
  return [...files, ...KEYED_ARTIFACT_TREES.flatMap((treeKeyedBy) => treeCarries(treeKeyedBy, from, to))].filter((artifact) =>
    existsSync(artifact.from),
  );
}

function treeCarries(treeKeyedBy: ArtifactKeyedByRepository, from: string, to: string): CarriedArtifact[] {
  const source = treeKeyedBy(from);
  const destination = treeKeyedBy(to);
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

function carryStateFileLastSoAnInterruptionResumes(inferred: CarriedIdentity, declared: CarriedIdentity): void {
  const read = readStateFile(inferred.stateFile);
  if (read.kind === "absent") return;
  if (read.kind === "unreadable") throw new StateFileUnreadableError(inferred.stateFile, read.cause);
  retargetCarriedPlanPaths(read.content, inferred, declared);
  renameSync(inferred.stateFile, declared.stateFile);
}

function retargetCarriedPlanPaths(content: string, inferred: CarriedIdentity, declared: CarriedIdentity): void {
  const { stateFile } = inferred;
  const planDirectory = planDirectoryKeyedBy(inferred.key);
  const carriedPlanDirectory = planDirectoryKeyedBy(declared.key);
  const retargeted = content
    .split("\n")
    .map((line) => planLineRebasedOn(line, planDirectory, carriedPlanDirectory))
    .join("\n");
  if (retargeted !== content) writeFileAtomically(path.dirname(stateFile), stateFile, retargeted, ".retarget.");
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

function twoIdentitiesHoldState(cwd: string, left: StateAtAnotherIdentity, task: NamedTaskIdentity): string {
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

function entryNamesOf(directory: string): string[] {
  return isDirectory(directory) ? readdirSync(directory) : [];
}
