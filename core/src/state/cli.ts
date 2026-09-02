import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ereReads } from "../shell/ere.ts";
import * as handoff from "./handoff.ts";
import * as plan from "./plan.ts";
import * as store from "./store.ts";
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
       oso-state handoff consume --slice <id> --attempt <n> --agent-id <id> --agent-type <type>

The SubagentStop hook publishes a provenance receipt, never a verdict. wait is
bounded and consume is one-shot. Handoff attempts start at 1 and timeout must
be between 0 and 600 seconds.
`;

class UsageError extends Error {}

class CloseSliceRefusedError extends Error {}

class DenyPatternRefusedError extends Error {}

const HANDOFF_SUBACTIONS = ["publish", "wait", "consume"] as const;
type HandoffSubaction = (typeof HANDOFF_SUBACTIONS)[number];

const HANDOFF_FLAGS = {
  "--slice": "slice",
  "--attempt": "attempt",
  "--agent-id": "agentId",
  "--agent-type": "agentType",
  "--hook-session": "hookSession",
  "--timeout": "timeout",
} as const;
type HandoffField = (typeof HANDOFF_FLAGS)[keyof typeof HANDOFF_FLAGS];
type HandoffCoordinates = Partial<Record<HandoffField, string>>;

export function main(argv: readonly string[]): number {
  try {
    return dispatch(argv);
  } catch (error) {
    return report(error, verbOf(argv));
  }
}

function verbOf(argv: readonly string[]): string {
  const first = argv[0];
  if (first === "journal" || first === "handoff") return first;
  return argv[2] ?? "";
}

function report(error: unknown, verb: string): number {
  if (error instanceof UsageError) {
    process.stderr.write(USAGE);
    return 1;
  }
  if (error instanceof CloseSliceRefusedError) {
    process.stderr.write(`oso-state: ${error.message}\n`);
    return 1;
  }
  if (error instanceof DenyPatternRefusedError) {
    process.stderr.write(`oso-state: ${error.message}\n`);
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
  if (error instanceof store.StateFileUnreadableError) {
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
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`oso-state: ${message}\n`);
  return 1;
}

function dispatch(argv: readonly string[]): number {
  const first = argv[0];
  if (first === "journal") return runJournal(argv.slice(1));
  if (first === "handoff") return dispatchHandoff(argv.slice(1));
  if (first !== "--session") throw new UsageError();

  const sessionId = sanitizeSession(argv[1] ?? "");
  if (sessionId === "") throw new UsageError();
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
    default:
      throw new UsageError();
  }
}

function runSet(sessionId: string, pairs: readonly string[]): number {
  if (pairs.length < 1) throw new UsageError();
  store.writeStateValues(process.cwd(), sessionId, pairs);
  return 0;
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
  mkdirSync(store.stateRootDirectory(), { recursive: true });
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
  mkdirSync(store.stateRootDirectory(), { recursive: true });
  return store.withLock(stateFile, sessionId, () => {
    const activeSlice = store.readValue(stateFile, "active_slice") ?? "none";
    if (activeSlice !== sliceId) {
      throw new CloseSliceRefusedError(
        `close-slice ${sliceId} refused: active_slice is ${activeSlice}, not ${sliceId}`,
      );
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
    throw new DenyPatternRefusedError(
      `deny-pattern add refused: this pattern is past what the production boundary can read: ${pattern}`,
    );
  }
  const stateFile = store.stateFileFor(process.cwd());
  const patternsFile = store.denyPatternsFileFor(stateFile);
  mkdirSync(store.stateRootDirectory(), { recursive: true });
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
  switch (subaction) {
    case "publish":
      readStdin();
      handoff.runHandoffPublish(cwd, coordinates, flags.hookSession ?? "");
      return 0;
    case "wait":
      process.stdout.write(handoff.runHandoffWait(cwd, coordinates, flags.timeout ?? ""));
      return 0;
    case "consume":
      process.stdout.write(handoff.runHandoffConsume(cwd, coordinates));
      return 0;
  }
}

function isHandoffSubaction(value: string | undefined): value is HandoffSubaction {
  return value !== undefined && (HANDOFF_SUBACTIONS as readonly string[]).includes(value);
}

function checkHandoffCoordinateShape(subaction: HandoffSubaction, coordinates: HandoffCoordinates): void {
  const hasTimeout = coordinates.timeout !== undefined;
  const hasHookSession = coordinates.hookSession !== undefined;
  if (subaction === "publish" && hasTimeout) throw new UsageError();
  if (subaction === "wait" && (!hasTimeout || hasHookSession)) throw new UsageError();
  if (subaction === "consume" && (hasTimeout || hasHookSession)) throw new UsageError();
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
