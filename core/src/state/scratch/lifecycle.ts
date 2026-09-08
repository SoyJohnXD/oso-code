import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runGate } from "../../gates/dispatch.ts";
import { hostEnvelope } from "../../hosts/envelope.ts";
import { lexShellCommands } from "../../shell/lexer.ts";
import { causeOf, isErrnoException, readValue, repositoryIdentityFor, sha256Hex, stateFileFor, stateRootDirectory, writeFileAtomically } from "../store.ts";
import { admitCapacity, assertCanonicalPath, copyInventory, inventoryFor, readRecipe, type InventoryEntry, type ScratchRecipe } from "./materialization.ts";
import { assertInheritedEnvironment, commandRuntime, prepareEnvironment, reviewCommand, runtimeInventory, type RuntimeInventory } from "./recipe.ts";
import { assertQuiescent, identityIsLive, processIdentity, requireScratchRuntime, sessionMembers, signalOwnedGroup, waitForQuiescence, type ProcessIdentity } from "./process.ts";

type CommandEvidence = { purpose: string; argv: readonly string[]; started: string; exit: number | null; outcome: string };
type ScratchRecord = {
  version: 1; id: string; root: string; sourceRoot: string; repository: string; sourceRef: string; sourceDigest: string;
  owner: string; uid: number; run: string; assignment: string; role: string; attempt: number; ordinal: number;
  recipe: ScratchRecipe; runtime: RuntimeInventory; inventory: readonly InventoryEntry[]; environment: Record<string, string>;
  reservation: { bytes: number; inodes: number }; commands: CommandEvidence[]; logBytes: number;
  state: "preparing" | "ready" | "starting" | "running" | "blocked" | "closed";
  supervisor: ProcessIdentity; command: ProcessIdentity | null; tracked: ProcessIdentity[]; supervisionViolation: boolean;
  cleanup: string; verdict: string; closedAt: string | null;
};

type ScratchFlags = Readonly<Record<string, string>>;
const maxLogBytes = 16 * 1024 * 1024;

export async function scratchMain(argv: readonly string[]): Promise<number> {
  try {
    requireScratchRuntime();
    assertInheritedEnvironment();
    const [action, ...remaining] = argv;
    const { flags, command } = scratchArguments(remaining);
    const directory = verificationDirectory(action);
    if (action === "create") {
      if (command.length !== 0) throw new Error("scratch create does not execute argv");
      process.stdout.write(`${createScratch(directory, flags)}\n`);
      return 0;
    }
    if (action === "run") return await runScratch(directory, flags, command);
    if (action !== "close" && action !== "recover") throw new Error("scratch expects create/run/close/recover");
    if (command.length !== 0) throw new Error("scratch cleanup accepts opaque ID only, not commands");
    if (action === "recover") recoverAdmission(directory, flags);
    withAdmission(directory, flags, () => {
      const record = ownedRecord(directory, flags);
      if (record.state === "preparing" && identityIsLive(record.supervisor)) throw new Error("scratch materialization owner remains active");
      closeScratch(record, action === "recover");
      expireClosedLogs(recordsIn(directory), flags);
    });
    return 0;
  } catch (error) {
    process.stderr.write(`oso-state: scratch refused: ${causeOf(error)}\n`);
    return 1;
  }
}

function scratchArguments(argv: readonly string[]): { flags: ScratchFlags; command: readonly string[] } {
  const flags: Record<string, string> = {};
  const allowed = new Set(["--owner", "--id", "--run", "--assignment", "--role", "--attempt", "--recipe", "--purpose", "--timeout"]);
  let index = 0;
  while (index < argv.length && argv[index] !== "--") {
    const name = argv[index] ?? "";
    const value = argv[index + 1];
    if (!allowed.has(name) || value === undefined || flags[name] !== undefined || value === "") throw new Error("scratch expects unique paired flags and literal argv after --");
    flags[name] = value;
    index += 2;
  }
  return { flags, command: argv.slice(index + 1) };
}

function verificationDirectory(action: string | undefined): string {
  const stateRoot = path.resolve(stateRootDirectory());
  const directory = path.join(stateRoot, "verification");
  const cwd = path.resolve(process.cwd());
  const insideRegistry = cwd.startsWith(`${directory}${path.sep}`);
  if (directory === cwd || directory.startsWith(`${cwd}${path.sep}`) || (action === "create" && insideRegistry)) throw new Error("scratch source-root separation required before registry creation");
  let existing = stateRoot;
  while (!existsSync(existing)) existing = path.dirname(existing);
  assertCanonicalPath(existing);
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  assertCanonicalPath(stateRoot);
  const stateStat = lstatSync(stateRoot);
  if (stateStat.uid !== process.getuid!() || (stateStat.mode & 0o022) !== 0) throw new Error("scratch state root is not exclusively writable by its owner");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertPrivateDirectory(directory);
  return directory;
}

function withAdmission<T>(directory: string, flags: ScratchFlags, operation: () => T): T {
  const lock = path.join(directory, ".admission");
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (isErrnoException(error) && error.code === "EEXIST") throw new Error("scratch admission lock held or unreconciled; never reclaimed by age", { cause: error });
    throw error;
  }
  try {
    writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ owner: sha256Hex(flags["--owner"] ?? ""), process: processIdentity(process.pid) }), { flag: "wx", mode: 0o600 });
    return operation();
  } finally {
    assertPrivateDirectory(lock);
    rmSync(lock, { recursive: true });
  }
}

function recoverAdmission(directory: string, flags: ScratchFlags): void {
  ownedRecord(directory, flags);
  const lock = path.join(directory, ".admission");
  if (!existsSync(lock)) return;
  assertPrivateDirectory(lock);
  const original = lstatSync(lock);
  const ownerFile = path.join(lock, "owner.json");
  assertCanonicalPath(ownerFile);
  const admission = JSON.parse(readFileSync(ownerFile, "utf8")) as { owner: string; process: ProcessIdentity };
  if (admission.owner !== sha256Hex(flags["--owner"] ?? "") || identityIsLive(admission.process)) throw new Error("scratch admission owner is foreign or active");
  const reconciliation = path.join(lock, "recovery");
  mkdirSync(reconciliation, { mode: 0o700 });
  const current = lstatSync(lock);
  if (current.dev !== original.dev || current.ino !== original.ino) {
    rmdirSync(reconciliation);
    throw new Error("scratch admission changed during recovery");
  }
  rmSync(ownerFile);
  rmdirSync(reconciliation);
  rmdirSync(lock);
}

function createScratch(directory: string, flags: ScratchFlags): string {
  const sourceRoot = path.resolve(process.cwd());
  assertCanonicalPath(sourceRoot);
  if (directory === sourceRoot || directory.startsWith(`${sourceRoot}${path.sep}`) || sourceRoot.startsWith(`${directory}${path.sep}`)) throw new Error("scratch source-root separation required");
  const coordinates = createCoordinates(flags);
  const recipe = readRecipe(sourceRoot, flags["--recipe"] ?? "");
  const inventory = inventoryFor(sourceRoot, recipe);
  const runtime = runtimeInventory(recipe);
  for (const command of recipe.commands) checkSourceCommand(sourceRoot, coordinates.run, recipe, command.argv);
  return withAdmission(directory, flags, () => {
    const previous = recordsIn(directory);
    expireClosedLogs(previous, flags);
    if (previous.some((record) => record.state === "blocked" || record.state === "preparing" || record.state === "starting")) throw new Error("scratch unresolved cleanup/process evidence blocks allocation");
    const repository = repositoryIdentityFor(sourceRoot);
    const sameAttempt = previous.filter((record) => record.repository === repository && record.run === coordinates.run && record.assignment === coordinates.assignment && record.role === coordinates.role && record.attempt === coordinates.attempt);
    if (sameAttempt.some((record) => record.state !== "closed")) throw new Error("scratch verification attempt already has a live materialization");
    const parents = new Set<string>();
    for (const entry of inventory) {
      let parent = path.dirname(entry.name);
      while (parent !== ".") { parents.add(parent); parent = path.dirname(parent); }
    }
    const reservation = { bytes: inventory.reduce((sum, entry) => sum + entry.bytes, recipe.headroomBytes + maxLogBytes), inodes: new Set([...inventory.map((entry) => entry.name), ...parents]).size + recipe.headroomInodes + 32 };
    const reserved = previous.filter((record) => record.state !== "closed").reduce((sum, record) => ({ bytes: sum.bytes + record.reservation.bytes, inodes: sum.inodes + record.reservation.inodes }), { bytes: 0, inodes: 0 });
    if (![reservation.bytes, reservation.inodes, reserved.bytes, reserved.inodes].every(Number.isSafeInteger)) throw new Error("scratch capacity estimate exceeds exact accounting range");
    admitCapacity(directory, reservation, reserved);
    const id = randomBytes(16).toString("hex");
    const root = path.join(directory, id);
    mkdirSync(root, { mode: 0o700 });
    const payload = path.join(root, "payload");
    const record: ScratchRecord = { version: 1, id, root, sourceRoot, repository, sourceRef: sourceRef(sourceRoot), sourceDigest: sha256Hex(JSON.stringify({ recipe, inventory })),
      ...coordinates, ordinal: sameAttempt.reduce((max, entry) => Math.max(max, entry.ordinal), 0) + 1, uid: process.getuid!(), recipe, runtime, inventory,
      environment: prepareEnvironment(payload, recipe, runtime), reservation, commands: [], logBytes: 0, state: "preparing", supervisor: processIdentity(process.pid)!, command: null, tracked: [], supervisionViolation: false,
      cleanup: "pending", verdict: "incomplete", closedAt: null };
    saveRecord(record);
    try {
      mkdirSync(path.join(payload, "work"), { recursive: true, mode: 0o700 });
      for (const home of ["home", "codex", "config", "cache", "data", "state", "tmp", "bin", "cache/npm"]) mkdirSync(path.join(payload, home), { recursive: true, mode: 0o700 });
      if (recipe.cacheRouting === "node-npm") {
        const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
        writeFileSync(path.join(payload, "bin", "tsc"), `#!${runtime.shell!.path}\nexec ${quote(runtime.node.path)} ${quote(path.join(payload, "work/node_modules/typescript/bin/tsc"))} "$@"\n`, { mode: 0o700 });
        writeFileSync(path.join(payload, "bin", "npm-shell"), `#!${runtime.shell!.path}\nPATH=${quote(record.environment["PATH"]!)}\nexport PATH\nexec ${quote(runtime.shell!.path)} "$@"\n`, { mode: 0o700 });
      }
      copyInventory(sourceRoot, path.join(payload, "work"), inventory);
      if (sha256Hex(JSON.stringify({ recipe, inventory: inventoryFor(sourceRoot, recipe) })) !== record.sourceDigest) throw new Error("scratch source changed during materialization");
      record.state = "ready";
      saveRecord(record);
      return id;
    } catch (error) {
      record.verdict = causeOf(error);
      closeScratch(record, false);
      throw error;
    }
  });
}

function createCoordinates(flags: ScratchFlags): Pick<ScratchRecord, "owner" | "run" | "assignment" | "role" | "attempt"> {
  const owner = flags["--owner"] ?? "";
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(owner)) throw new Error("scratch requires a private owner token of 24 to 128 characters");
  const run = flags["--run"] ?? "";
  const assignment = flags["--assignment"] ?? "";
  const role = flags["--role"] ?? "";
  if (![run, assignment, role].every((value) => /^[A-Za-z0-9_-]{1,128}$/.test(value))) throw new Error("scratch requires run/assignment/role coordinates");
  const attempt = Number(flags["--attempt"]);
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error("scratch verification attempt must be a positive integer");
  return { owner: sha256Hex(owner), run, assignment, role, attempt };
}

function sourceRef(sourceRoot: string): string {
  const result = spawnSync("git", ["-C", sourceRoot, "rev-parse", "--verify", "HEAD"], { encoding: "utf8", env: { PATH: process.env["PATH"], GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
  if (result.error !== undefined) throw result.error;
  if (result.status === 0) return result.stdout.trim();
  if (result.stderr.includes("not a git repository")) return "unversioned-content-snapshot";
  throw new Error(`scratch source ref unavailable: ${result.stderr.trim()}`);
}

function checkSourceCommand(sourceRoot: string, run: string, recipe: ScratchRecipe, argv: readonly string[]): void {
  if (argv.length === 0 || argv.some((token) => token.includes("\0") || /[\r\n]/.test(token))) throw new Error("scratch literal argv required");
  const commandLine = argv.map((token) => `'${token.replaceAll("'", "'\\''")}'`).join(" ");
  const session = readValue(stateFileFor(sourceRoot), "session") ?? run;
  const envelope = hostEnvelope({ host: "codex", agentSession: session, stateBin: "oso-state" }, { sessionId: session, cwd: sourceRoot, toolName: "Bash", commandLine });
  for (const gate of [["unknown", "--allow", "Bash"], ["edits"], ["commit"], ["proddeploy"]]) {
    const result = runGate(gate, envelope);
    if (result.verdict.kind !== "allow") throw new Error(`scratch source gate ${gate[0]} refused: ${result.stdout}${result.stderr}`);
  }
  if (lexShellCommands(commandLine).some((record) => record.kind === "unreadPayload")) throw new Error("scratch opaque wrapper refused");
  if (!recipe.commands.some((command) => JSON.stringify(command.argv) === JSON.stringify(argv))) throw new Error("scratch argv is not an explicitly reviewed recipe command");
  reviewCommand(sourceRoot, recipe, argv);
}

async function runScratch(directory: string, flags: ScratchFlags, argv: readonly string[]): Promise<number> {
  const timeout = Number(flags["--timeout"]);
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 3600) throw new Error("scratch timeout must be greater than 0 and at most 3600 seconds");
  const record = withAdmission(directory, flags, () => {
    const record = ownedRecord(directory, flags);
    if (record.state !== "ready") throw new Error(`scratch cannot run from ${record.state}`);
    if (!record.recipe.commands.some((command) => command.purpose === flags["--purpose"] && JSON.stringify(command.argv) === JSON.stringify(argv))) throw new Error("scratch purpose/argv is not reviewed");
    if (sha256Hex(JSON.stringify({ recipe: record.recipe, inventory: inventoryFor(record.sourceRoot, record.recipe) })) !== record.sourceDigest || sourceRef(record.sourceRoot) !== record.sourceRef) throw new Error("scratch source fingerprint changed; close and obtain fresh verification");
    if (JSON.stringify(runtimeInventory(record.recipe)) !== JSON.stringify(record.runtime)) throw new Error("scratch runtime changed; fresh verification required");
    checkSourceCommand(record.sourceRoot, record.run, record.recipe, argv);
    assertDeletionTree(path.join(record.root, "payload"));
    record.state = "starting";
    record.supervisor = processIdentity(process.pid)!;
    record.commands.push({ purpose: flags["--purpose"]!, argv, started: new Date().toISOString(), exit: null, outcome: "incomplete" });
    saveRecord(record);
    return record;
  });
  return await supervise(record, argv, timeout);
}

async function supervise(record: ScratchRecord, argv: readonly string[], timeout: number): Promise<number> {
  const execution = commandRuntime(argv, record.runtime);
  const child = spawn(execution[0]!, execution.slice(1), { cwd: path.join(record.root, "payload", "work"), env: record.environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const evidence = record.commands.at(-1)!;
  let stopped = "";
  let failure: unknown;
  let exit: number | null = null;
  let closed = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let trackingTimer: ReturnType<typeof setInterval> | undefined;
  const terminate = (reason: string): void => {
    if (stopped !== "") return;
    stopped = reason;
    try {
      if (record.command === null) throw new Error("scratch process identity unavailable after spawn");
      signalOwnedGroup(record.command, "SIGTERM");
      killTimer = setTimeout(() => {
        try { signalOwnedGroup(record.command!, "SIGKILL"); } catch (error) { failure = error; }
      }, 250);
    } catch (error) { failure = error; }
  };
  const interrupted = (): void => terminate("cancelled");
  const timer = setTimeout(() => terminate("timeout"), timeout * 1000);
  const hardDeadline = setTimeout(() => {
    failure = new Error("scratch command pipes did not close within the bounded supervision deadline");
    record.supervisionViolation = true;
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    child.stdout.destroy();
    child.stderr.destroy();
  }, timeout * 1000 + 1500);
  process.on("SIGINT", interrupted);
  process.on("SIGTERM", interrupted);
  const collect = (chunk: Buffer): void => {
    try {
      const remaining = maxLogBytes - record.logBytes;
      const kept = chunk.subarray(0, remaining);
      if (kept.length !== 0) {
        appendFileSync(path.join(record.root, "raw.log"), kept, { mode: 0o600 });
        record.logBytes += kept.length;
        process.stdout.write(kept);
      }
      if (chunk.length > remaining) terminate("combined log overflow; incomplete");
    } catch (error) { failure = error; terminate("log write failure"); }
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.on("error", (error) => { failure = error; });
  const completion = new Promise<void>((resolve) => child.on("close", (code) => { exit = code; closed = true; resolve(); }));
  try {
    record.command = child.pid === undefined ? null : processIdentity(child.pid) ?? null;
    if (record.command === null || record.command.group !== child.pid || record.command.session !== child.pid) throw new Error("scratch owned session identity unavailable; recovery required");
    record.state = "running";
    record.tracked = [record.command];
    saveRecord(record);
    trackingTimer = setInterval(() => {
      try {
        for (const tracked of record.tracked) identityIsLive(tracked);
        const newlySeen = sessionMembers(record.command!).filter((member) => !record.tracked.some((tracked) => tracked.pid === member.pid && tracked.start === member.start));
        if (newlySeen.some((member) => member.group !== record.command!.group || member.session !== record.command!.session)) throw new Error("scratch reviewed process group/session was violated");
        if (newlySeen.length !== 0) {
          record.tracked.push(...newlySeen);
          saveRecord(record);
        }
      } catch (error) {
        record.supervisionViolation = true;
        failure = error;
        terminate("process tracking uncertainty");
      }
    }, 10);
    await completion;
    clearInterval(trackingTimer);
    if (killTimer !== undefined) {
      clearTimeout(killTimer);
      signalOwnedGroup(record.command, "SIGKILL");
    }
    await waitForQuiescence(record.command, record.tracked);
    if (failure !== undefined) throw failure;
    if (record.supervisionViolation) throw new Error("scratch reviewed foreground supervision was violated; recovery blocked");
    evidence.exit = exit;
    evidence.outcome = stopped || (exit === 0 ? "pass" : "fail");
    record.verdict = evidence.outcome;
    record.command = null;
    record.state = "ready";
    saveRecord(record);
    if (exit !== 0 || stopped !== "") closeScratch(record, false);
    return exit === 0 && stopped === "" ? 0 : 1;
  } catch (error) {
    record.state = "blocked";
    record.cleanup = `blocked: ${causeOf(error)}`;
    evidence.outcome = record.cleanup;
    terminate("supervision failure");
    if (record.command !== null && !record.supervisionViolation) {
      try {
        signalOwnedGroup(record.command, "SIGKILL");
        await waitForQuiescence(record.command, record.tracked);
      } catch (cleanupError) {
        record.supervisionViolation = true;
        record.cleanup += `; termination uncertain: ${causeOf(cleanupError)}`;
      }
    }
    if (!closed && record.command === null) child.kill("SIGKILL");
    await completion;
    saveRecord(record);
    throw error;
  } finally {
    clearTimeout(timer);
    clearTimeout(hardDeadline);
    if (trackingTimer !== undefined) clearInterval(trackingTimer);
    if (killTimer !== undefined) clearTimeout(killTimer);
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
  }
}

function closeScratch(record: ScratchRecord, recovery: boolean): void {
  if (record.state === "closed") return;
  if (record.state === "starting") throw new Error("scratch spawn identity uncertain; cleanup refused");
  if (record.supervisionViolation) throw new Error("scratch reviewed recipe/process tracking violated; recovery refused");
  if (record.state === "running" || record.state === "blocked") {
    if (!recovery || identityIsLive(record.supervisor)) throw new Error("scratch supervisor active or recovery required");
    if (record.command === null && !record.cleanup.startsWith("cleanup failed:")) throw new Error("scratch process identity unknown; cleanup refused");
    if (record.command !== null) assertQuiescent(record.command);
    if (record.tracked.some(identityIsLive)) throw new Error("scratch tracked process remains active; cleanup refused");
  }
  try {
    assertPrivateDirectory(record.root);
    const payload = path.join(record.root, "payload");
    if (existsSync(payload)) {
      assertDeletionTree(payload);
      rmSync(payload, { recursive: true });
    }
    record.state = "closed";
    record.command = null;
    record.cleanup = "owned payload removed; quiescent";
    record.closedAt = new Date().toISOString();
    saveRecord(record);
  } catch (error) {
    record.state = "blocked";
    record.cleanup = `cleanup failed: ${causeOf(error)}`;
    saveRecord(record);
    throw error;
  }
}

function assertDeletionTree(root: string): void {
  assertCanonicalPath(root);
  for (const name of readdirSync(root)) {
    const target = path.join(root, name);
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink !== 1)) throw new Error(`scratch cleanup link/special-file uncertainty: ${target}`);
    if (stat.isDirectory()) assertDeletionTree(target);
  }
}

function assertPrivateDirectory(root: string): void {
  assertCanonicalPath(root);
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o700) throw new Error(`scratch private owned directory required: ${root}`);
}

function ownedRecord(directory: string, flags: ScratchFlags): ScratchRecord {
  const id = flags["--id"] ?? "";
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("scratch cleanup/run requires a registered opaque ID, never a path");
  const record = readRecord(directory, id);
  if (record.owner !== sha256Hex(flags["--owner"] ?? "")) throw new Error("scratch foreign owner refused");
  return record;
}

function recordsIn(directory: string): ScratchRecord[] {
  return readdirSync(directory).filter((name) => name !== ".admission").map((id) => readRecord(directory, id));
}

function readRecord(directory: string, id: string): ScratchRecord {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error(`scratch unrecognized registry entry: ${id}`);
  const root = path.join(directory, id);
  assertPrivateDirectory(root);
  const file = path.join(root, "record.json");
  assertCanonicalPath(file);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o600) throw new Error("scratch metadata ownership is uncertain");
  const record = JSON.parse(readFileSync(file, "utf8")) as ScratchRecord;
  if (record.version !== 1 || record.id !== id || record.root !== root || record.uid !== process.getuid!() || !["preparing", "ready", "starting", "running", "blocked", "closed"].includes(record.state)) throw new Error("scratch metadata identity/state mismatch");
  if (record.sourceRoot === directory || record.sourceRoot.startsWith(`${directory}/`) || directory.startsWith(`${record.sourceRoot}/`)) throw new Error("scratch recorded source separation invalid");
  if (!/^[a-f0-9]{64}$/.test(record.owner) || !path.isAbsolute(record.sourceRoot) || !Array.isArray(record.tracked) || typeof record.supervisionViolation !== "boolean" ||
      ![record.attempt, record.ordinal].every((amount) => Number.isSafeInteger(amount) && amount > 0) ||
      ![record.reservation?.bytes, record.reservation?.inodes, record.logBytes].every((amount) => Number.isSafeInteger(amount) && amount >= 0)) throw new Error("scratch malformed ownership/capacity/process metadata");
  if (JSON.stringify(record.environment) !== JSON.stringify(prepareEnvironment(path.join(root, "payload"), record.recipe, record.runtime))) throw new Error("scratch environment record differs from owned routing");
  return record;
}

function saveRecord(record: ScratchRecord): void {
  assertPrivateDirectory(record.root);
  writeFileAtomically(record.root, path.join(record.root, "record.json"), `${JSON.stringify(record)}\n`, ".record.");
}

function expireClosedLogs(records: readonly ScratchRecord[], flags: ScratchFlags): void {
  const retentionMs = 7 * 24 * 60 * 60 * 1000;
  for (const record of records) {
    if (record.owner !== sha256Hex(flags["--owner"] ?? "") || record.state !== "closed" || record.closedAt === null || !Number.isFinite(Date.parse(record.closedAt)) || Date.now() - Date.parse(record.closedAt) < retentionMs) continue;
    const log = path.join(record.root, "raw.log");
    if (!existsSync(log)) continue;
    assertCanonicalPath(log);
    const stat = lstatSync(log);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o600) throw new Error("scratch closed raw log ownership uncertain");
    rmSync(log);
  }
}
