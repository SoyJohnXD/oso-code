import { readFileSync } from "node:fs";
import path from "node:path";
import { abstractionScanReport } from "../scan/abstraction-scan.ts";
import { ScanFailure } from "../scan/changed-lines.ts";
import { commentScanReport } from "../scan/comment-scan.ts";
import { ereReads } from "../shell/ere.ts";
import * as handoff from "./handoff.ts";
import { migrateInferredTaskState } from "./migration.ts";
import * as plan from "./plan.ts";
import * as store from "./store.ts";
import { scratchMain } from "./scratch/lifecycle.ts";
import * as transitions from "./transitions.ts";

const USAGE = `usage: oso-state --session <id> set key=value [key=value ...]
       oso-state --session <id> get key
       oso-state --session <id> show
       oso-state --session <id> clear
       oso-state --session <id> close-slice <n>
       oso-state --session <id> event <type> [detail]
       oso-state --session <id> capture-plan <sha256>
       oso-state --session <id> approve-plan <sha256>
       oso-state --session <id> cancel-plan <sha256>
       oso-state --session <id> amend-plan <slice-id>
       oso-state --session <id> deny-pattern add <pattern>
       oso-state journal <text>
       oso-state journal --path
       oso-state handoff publish --slice <id> --attempt <n> --agent-id <id> --agent-type <type> --hook-session <id>
       oso-state handoff wait --slice <id> --attempt <n> --agent-id <id> --agent-type <type> --timeout <seconds>
       oso-state handoff consume --slice <id> --attempt <n> --agent-id <id> --agent-path <canonical> --agent-type <type>
       oso-state handoff resolve-codex --agent-path <canonical> --slice <id> --attempt <n> --agent-type <role>
       oso-state handoff adopt --agent-id <id> --agent-path <canonical> --slice <id> --attempt <n> --agent-type <type>
       oso-state scan comments <ref>
       oso-state scan abstractions <ref>

The SubagentStop hook publishes a provenance receipt, never a verdict. wait is
bounded and consume is one-shot. Handoff attempts start at 1 and timeout must
be between 0 and 600 seconds. adopt proves an asserted agent id against its
own native rollout without requiring the current session to be its parent;
consume now demands that same proof before it destroys a receipt.

scan reads the working directory's own repository, reports every hit on stdout
and exits 0 whether or not it found any. comments flags the inline comments the
diff since <ref> adds; abstractions flags the exports it adds that fewer than
two use sites reach.
`;

class UsageError extends Error {}

class RefusedError extends Error {
  readonly verb: string;

  constructor(verb: string, reason: string) {
    super(reason);
    this.verb = verb;
  }
}

const HANDOFF_SUBACTIONS = ["publish", "wait", "consume", "resolve-codex", "adopt"] as const;
type HandoffSubaction = (typeof HANDOFF_SUBACTIONS)[number];

const HANDOFF_FLAGS = {
  "--slice": "slice",
  "--attempt": "attempt",
  "--agent-id": "agentId",
  "--agent-path": "agentPath",
  "--agent-type": "agentType",
  "--hook-session": "hookSession",
  "--timeout": "timeout",
} as const;
type HandoffField = (typeof HANDOFF_FLAGS)[keyof typeof HANDOFF_FLAGS];
type HandoffCoordinates = Partial<Record<HandoffField, string>>;

function main(argv: readonly string[]): number {
  try {
    return dispatch(argv);
  } catch (error) {
    return report(error, verbOf(argv));
  }
}

export async function supervisedMain(argv: readonly string[]): Promise<number> {
  if (argv[0] === "scratch") return await scratchMain(argv.slice(1));
  return main(argv);
}

function verbOf(argv: readonly string[]): string {
  const first = argv[0];
  if (first === "journal" || first === "handoff" || first === "scan") return first;
  return argv[2] ?? "";
}

function report(error: unknown, verb: string): number {
  if (error instanceof UsageError) {
    process.stderr.write(USAGE);
    return 1;
  }
  if (error instanceof RefusedError) {
    process.stderr.write(`oso-state: ${error.verb} refused: ${error.message}\n`);
    return 1;
  }
  if (error instanceof store.LockTimeoutError) {
    process.stderr.write(`oso-state: ${error.message}\n`);
    return 1;
  }
  if (error instanceof store.JournalAppendError) {
    process.stderr.write(`oso-state: journal: ${error.message}\n`);
    return 1;
  }
  if (error instanceof store.StateFileUnreadableError || error instanceof store.StateRootUnwritableError) {
    process.stderr.write(`oso-state: ${verb}: ${error.message}\n`);
    return 1;
  }
  if (error instanceof plan.PlanApprovalError) {
    process.stderr.write(`oso-state: ${error.message}\n`);
    return 1;
  }
  if (error instanceof plan.PlanFailure) {
    process.stderr.write(`oso-state: plan: ${error.message}\n`);
    return 1;
  }
  if (error instanceof handoff.HandoffFailure) {
    process.stderr.write(`oso-state: handoff: ${error.message}\n`);
    return 1;
  }
  if (error instanceof ScanFailure) {
    process.stderr.write(`oso-state: scan: ${error.message}\n`);
    return 1;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`oso-state: ${message}\n`);
  return 1;
}

function dispatch(argv: readonly string[]): number {
  const first = argv[0];
  if (first === "scan") return dispatchScan(argv.slice(1));

  const sessionId = first === "--session" ? sanitizeSession(argv[1] ?? "") : "";
  const wellFormed = first === "journal" || first === "handoff" || (first === "--session" && sessionId !== "");
  if (!wellFormed) throw new UsageError();
  migrateInferredTaskState(process.cwd(), sessionId);
  if (first === "journal") return runJournal(argv.slice(1));
  if (first === "handoff") return dispatchHandoff(argv.slice(1));
  const action = argv[2] ?? "";
  const remaining = argv.slice(3);

  switch (action) {
    case "set":
      return runSet(sessionId, remaining);
    case "get":
      return runGet(remaining);
    case "show":
      return runShow();
    case "clear":
      return runClear(sessionId);
    case "close-slice":
      return runCloseSlice(sessionId, remaining);
    case "event":
      return runEvent(sessionId, remaining);
    case "journal":
      return runJournal(remaining);
    case "capture-plan":
      return runCapturePlan(sessionId, remaining);
    case "approve-plan":
      return runApprovePlan(sessionId, remaining);
    case "cancel-plan":
      return runCancelPlan(sessionId, remaining);
    case "amend-plan":
      return runAmendPlan(sessionId, remaining);
    case "deny-pattern":
      return runDenyPattern(sessionId, remaining);
    case "handoff":
      return dispatchHandoff(remaining);
    case "scan":
      return dispatchScan(remaining);
    default:
      throw new UsageError();
  }
}

function dispatchScan(remaining: readonly string[]): number {
  const [subject, ref, ...rest] = remaining;
  if (rest.length > 0 || ref === undefined || ref === "") throw new UsageError();
  if (subject === "comments") return writeScan(commentScanReport(process.cwd(), ref));
  if (subject === "abstractions") return writeScan(abstractionScanReport(process.cwd(), ref));
  throw new UsageError();
}

function writeScan(report: string): number {
  process.stdout.write(report);
  return 0;
}

function runSet(sessionId: string, pairs: readonly string[]): number {
  if (pairs.length < 1) throw new UsageError();
  store.writeStateValues(process.cwd(), sessionId, pairs);
  if (pairs.includes(UNATTENDED_ARMING)) recordWhatTheUnattendedRunArmsOver(sessionId);
  return 0;
}

const UNATTENDED_ARMING = "auto=running";

function recordWhatTheUnattendedRunArmsOver(sessionId: string): void {
  const task = store.taskIdentityFor(process.cwd());
  if (task.kind === "unknown") return;
  const patternsFile = store.denyPatternsFileFor(task.stateFile);
  const whyItWillNotBite = whyTheDenyPatternsFileWillNotBite(store.readStateFile(patternsFile));
  if (whyItWillNotBite !== undefined) {
    store.logEvent({ event: "boundary-unpatterned", session: sessionId, command: `${patternsFile}: ${whyItWillNotBite}` });
  }
  const inferred = store.inferredIdentityFor(process.cwd());
  if (inferred === task.identity) return;
  store.logEvent({ event: "identity-rekeyed", session: sessionId, command: `${inferred} -> ${task.identity}` });
}

function whyTheDenyPatternsFileWillNotBite(read: store.StateFileRead): string | undefined {
  if (read.kind === "absent") return "absent";
  if (read.kind === "unreadable") return `unreadable: ${read.cause}`;
  return undefined;
}

function runGet(remaining: readonly string[]): number {
  if (remaining.length !== 1) throw new UsageError();
  const key = remaining[0] as string;
  const stateFile = store.stateFileFor(process.cwd());
  const value = store.readValue(stateFile, key);
  if (value !== undefined) process.stdout.write(`${value}\n`);
  return 0;
}

function runShow(): number {
  const stateFile = store.stateFileFor(process.cwd());
  const read = store.readStateFile(stateFile);
  if (read.kind === "absent") {
    process.stdout.write(`no state at ${stateFile}\n`);
    return 0;
  }
  if (read.kind === "unreadable") throw new store.StateFileUnreadableError(stateFile, read.cause);
  process.stdout.write(read.content);
  return 0;
}

function runClear(sessionId: string): number {
  const stateFile = store.stateFileFor(process.cwd());
  store.requireWritableStateRoot();
  return store.withLock(stateFile, sessionId, () => {
    store.clearStateFile(stateFile);
    store.logEvent({ event: "clear", session: sessionId });
    return 0;
  });
}

function runCloseSlice(sessionId: string, remaining: readonly string[]): number {
  if (remaining.length !== 1) throw new UsageError();
  const sliceId = remaining[0] as string;
  const stateFile = store.stateFileFor(process.cwd());
  store.requireWritableStateRoot();
  return store.withLock(stateFile, sessionId, () => {
    const activeSlice = store.readValue(stateFile, "active_slice") ?? "none";
    if (activeSlice !== sliceId) {
      throw new RefusedError(`close-slice ${sliceId}`, `active_slice is ${activeSlice}, not ${sliceId}`);
    }
    const patch = transitions.closeSlice();
    store.writeStatePairs(
      stateFile,
      Object.entries(patch).map(([key, value]) => `${key}=${value}`),
      sessionId,
    );
    store.logEvent({ event: "close-slice", session: sessionId, command: sliceId });
    return 0;
  });
}

function runDenyPattern(sessionId: string, remaining: readonly string[]): number {
  if (remaining.length !== 2 || remaining[0] !== "add") throw new UsageError();
  const pattern = remaining[1] as string;
  if (ereReads(pattern, "") === "untranslatable") {
    throw new RefusedError("deny-pattern add", `this pattern is past what the production boundary can read: ${pattern}`);
  }
  const stateFile = store.stateFileFor(process.cwd());
  const patternsFile = store.denyPatternsFileFor(stateFile);
  store.requireWritableStateRoot();
  return store.withLock(stateFile, sessionId, () => {
    const read = store.readStateFile(patternsFile);
    if (read.kind === "unreadable") throw new store.StateFileUnreadableError(patternsFile, read.cause);
    const existing = read.kind === "ok" ? read.content.split("\n").filter((line) => line !== "") : [];
    if (existing.includes(pattern)) {
      process.stdout.write(`oso-state: deny-pattern already present in ${patternsFile}\n`);
      return 0;
    }
    const content = [...existing, pattern].map((line) => `${line}\n`).join("");
    store.writeFileAtomically(path.dirname(patternsFile), patternsFile, content, ".patterns.");
    store.logEvent({ event: "deny-pattern-add", session: sessionId, command: pattern });
    process.stdout.write(`oso-state: wrote ${patternsFile}\n`);
    return 0;
  });
}

function runEvent(sessionId: string, remaining: readonly string[]): number {
  if (remaining.length < 1 || remaining.length > 2) throw new UsageError();
  const type = remaining[0] as string;
  const detail = remaining[1] ?? "";
  store.logEvent({ event: type, session: sessionId, command: detail });
  return 0;
}

function runJournal(remaining: readonly string[]): number {
  if (remaining.length !== 1) throw new UsageError();
  const text = remaining[0] as string;
  if (text === "") throw new UsageError();
  const journalFile = store.journalFileFor(process.cwd());
  if (text === "--path") {
    process.stdout.write(`${journalFile}\n`);
    return 0;
  }
  store.appendJournal(journalFile, text);
  return 0;
}

function runCapturePlan(sessionId: string, remaining: readonly string[]): number {
  if (remaining.length !== 1) throw new UsageError();
  const digest = remaining[0] as string;
  return plan.runCapturePlan(process.cwd(), sessionId, digest, readStdin());
}

function runApprovePlan(sessionId: string, remaining: readonly string[]): number {
  if (remaining.length !== 1) throw new UsageError();
  const digest = remaining[0] as string;
  return plan.runApprovePlan(process.cwd(), sessionId, digest);
}

function runCancelPlan(sessionId: string, remaining: readonly string[]): number {
  if (remaining.length !== 1) throw new UsageError();
  const digest = remaining[0] as string;
  return plan.runCancelPlan(process.cwd(), sessionId, digest);
}

function runAmendPlan(sessionId: string, remaining: readonly string[]): number {
  if (remaining.length !== 1) throw new UsageError();
  const sliceId = remaining[0] as string;
  return plan.runAmendPlan(process.cwd(), sessionId, sliceId, readStdin());
}

function readStdin(): string {
  return readFileSync(0, "utf8");
}

function dispatchHandoff(remaining: readonly string[]): number {
  const [subaction, ...rest] = remaining;
  if (!isHandoffSubaction(subaction)) throw new UsageError();
  const flags = parseHandoffCoordinates(rest);
  checkHandoffCoordinateShape(subaction, flags);
  const coordinates: handoff.HandoffCoordinates = {
    slice: flags.slice ?? "",
    attempt: flags.attempt ?? "",
    agentId: flags.agentId ?? "",
    agentType: flags.agentType ?? "",
  };
  const cwd = process.cwd();
  const claim = { ...coordinates, agentPath: flags.agentPath ?? "" };
  switch (subaction) {
    case "resolve-codex":
      process.stdout.write(handoff.runHandoffResolveCodex(cwd, claim) + "\n");
      return 0;
    case "adopt":
      handoff.runHandoffAdopt(cwd, claim);
      return 0;
    case "publish":
      readStdin();
      handoff.runHandoffPublish(cwd, coordinates, flags.hookSession ?? "");
      return 0;
    case "wait":
      process.stdout.write(handoff.runHandoffWait(cwd, coordinates, flags.timeout ?? ""));
      return 0;
    case "consume":
      process.stdout.write(handoff.runHandoffConsume(cwd, claim));
      return 0;
  }
}

function isHandoffSubaction(value: string | undefined): value is HandoffSubaction {
  return value !== undefined && (HANDOFF_SUBACTIONS as readonly string[]).includes(value);
}

function checkHandoffCoordinateShape(subaction: HandoffSubaction, coordinates: HandoffCoordinates): void {
  const hasAgentPath = coordinates.agentPath !== undefined;
  const hasTimeout = coordinates.timeout !== undefined;
  const hasHookSession = coordinates.hookSession !== undefined;
  if (subaction === "resolve-codex" && (!hasAgentPath || coordinates.agentId !== undefined || hasTimeout || hasHookSession)) {
    throw new UsageError();
  }
  if (subaction === "adopt" && (!hasAgentPath || hasTimeout || hasHookSession)) throw new UsageError();
  if (subaction === "consume" && (!hasAgentPath || hasTimeout || hasHookSession)) throw new UsageError();
  if (subaction === "publish" && (hasAgentPath || hasTimeout)) throw new UsageError();
  if (subaction === "wait" && (hasAgentPath || !hasTimeout || hasHookSession)) throw new UsageError();
}

function parseHandoffCoordinates(args: readonly string[]): HandoffCoordinates {
  const coordinates: HandoffCoordinates = {};
  let index = 0;
  while (index < args.length) {
    if (index + 1 >= args.length) throw new UsageError();
    const flag = args[index] as string;
    const field = (HANDOFF_FLAGS as Record<string, HandoffField | undefined>)[flag];
    if (field === undefined) throw new UsageError();
    if (coordinates[field] !== undefined) throw new UsageError();
    coordinates[field] = args[index + 1] as string;
    index += 2;
  }
  return coordinates;
}

function sanitizeSession(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9-]/g, "");
}
