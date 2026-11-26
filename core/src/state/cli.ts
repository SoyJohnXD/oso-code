import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { abstractionScanReport } from "../scan/abstraction-scan.ts";
import { ScanFailure } from "../scan/changed-lines.ts";
import { commentScanReport } from "../scan/comment-scan.ts";
import { ereReads } from "../shell/ere.ts";
import { isSliceId } from "../verdict/grammar.ts";
import { greenReceiptOf, type GreenReceipt } from "../verdict/receipt.ts";
import {
  appendMarker,
  newlyArmedSliceOf,
  readVerdicts,
  SLICE_MARKS,
  verdictsFileFor,
  VERIFY_GREEN_UNRECEIPTED,
} from "../verdict/record.ts";
import {
  appendLaunchToken,
  appendWave,
  launchTokenRefusal,
  newestWave,
  newestWaveNamed,
  readWaveLog,
  SLICE_RISKS,
  type WaveSlice,
  wavesFileFor,
} from "../verdict/wave.ts";
import { type GreensRead, integrationRedsIn, renderReportTable, unreceiptedGreensIn, verdictMetrics } from "../verdict/report.ts";
import * as knownKeys from "./known-keys.ts";
import * as plan from "./plan.ts";
import * as store from "./store.ts";
import * as transitions from "./transitions.ts";
import { watchInFlight } from "./watch.ts";

const USAGE = `usage: oso-state --session <id> set key=value [key=value ...]
       oso-state --session <id> get key
       oso-state --session <id> show
       oso-state --session <id> clear
       oso-state --session <id> close
       oso-state --session <id> close-slice <n>
       oso-state --session <id> event <type> [detail]
       oso-state --session <id> capture-plan <sha256>
       oso-state --session <id> approve-plan <sha256>
       oso-state --session <id> cancel-plan <sha256>
       oso-state --session <id> amend-plan <slice-id>
       oso-state --session <id> deny-pattern add <pattern>
       oso-state --session <id> watch
       oso-state --session <id> mark <diagnosed|escalated|empty-result> [slice]
       oso-state --session <id> wave start <wave> <slice>=<low|high> [<slice>=<low|high> ...]
       oso-state --session <id> launch-token <wave> <token> <slice> [<slice> ...]
       oso-state journal <text>
       oso-state journal --path
       oso-state scan comments <ref>
       oso-state scan abstractions <ref>
       oso-state report [--json]

scan reads the working directory's own repository, reports every hit on stdout
and exits 0 whether or not it found any. comments flags the inline comments the
diff since <ref> adds; abstractions flags the exports it adds that fewer than
two use sites reach.

report reads this repository's verdict records and prints the armed slice with
its rounds since its arming and since its newest diagnosis, the first-fail
rate, rounds per slice, escalated slices, verdicts by model, malformed reports
and unreceipted greens; --json prints the same fields as one JSON object.

mark records a diagnosis, an escalation or an empty applier result against the
armed slice, and is refused when no slice is armed; inside a started wave it
takes the id of one of the wave's slices instead.

wave start records a wave's slices with their risk and arms each of them, so its
rounds are counted per slice. launch-token registers the slices one verifier
launch covers and is refused for an id outside the wave, a batch of more than 3
slices or a batch holding a high-risk slice.

watch polls this session's in-flight delegations and exits 0 once none is left,
or 3 naming each one silent for 60 minutes, in flight for 3 hours or ended
without notice; each is named once across watches.
`;

class UsageError extends Error {}

class RefusedError extends Error {
  readonly verb: string;

  constructor(verb: string, reason: string) {
    super(reason);
    this.verb = verb;
  }
}

export function main(argv: readonly string[]): number {
  try {
    return dispatch(argv);
  } catch (error) {
    return report(error, verbOf(argv));
  }
}

function verbOf(argv: readonly string[]): string {
  const first = argv[0];
  if (first === "journal" || first === "scan" || first === "report") return first;
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
  if (error instanceof store.GatesOwnedElsewhereError) {
    process.stderr.write(`oso-state: ${verb} refused: ${error.message}\n`);
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
  if (first === "journal") return runJournal(argv.slice(1));
  if (first === "scan") return dispatchScan(argv.slice(1));
  if (first === "report") return runReport(argv.slice(1));
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
    case "close":
      return runClose(sessionId);
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
    case "watch":
      return runWatch(sessionId, remaining);
    case "mark":
      return runMark(sessionId, remaining);
    case "wave":
      return runWave(sessionId, remaining);
    case "launch-token":
      return runLaunchToken(sessionId, remaining);
    case "scan":
      return dispatchScan(remaining);
    case "report":
      return runReport(remaining);
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
  const rejection = knownKeys.setPairRejection(pairs);
  if (rejection !== undefined) throw new RefusedError("set", rejection);
  const stateFile = store.stateFileFor(process.cwd());
  mkdirSync(store.stateRootDirectory(), { recursive: true });
  return store.withLock(stateFile, sessionId, () => {
    const owner = store.foreignGateOwner(stateFile, sessionId);
    if (owner !== undefined && knownKeys.pairsTouchAGateKey(pairs)) throw new store.GatesOwnedElsewhereError(owner);
    const written = new Map(pairs.map(store.splitPair));
    const preWriteSlice = store.readValue(stateFile, "active_slice") ?? "none";
    const receipt = receiptOfGreen(stateFile, "set", preWriteSlice, written);
    const content = store.writeStatePairs(stateFile, pairs, owner ?? sessionId);
    store.logSet(sessionId, pairs);
    logUnreceiptedGreen(sessionId, receipt);
    markArming(stateFile, sessionId, newlyArmedSliceOf(preWriteSlice, written), content);
    process.stdout.write(content);
    return 0;
  });
}

function receiptOfGreen(
  stateFile: string,
  verb: string,
  preWriteSlice: string,
  written: ReadonlyMap<string, string>,
): GreenReceipt {
  const receipt = greenReceiptOf({ verdictsFile: verdictsFileFor(stateFile), wavesFile: wavesFileFor(stateFile) }, preWriteSlice, written);
  if (receipt.kind === "refused") throw new RefusedError(verb, receipt.reason);
  return receipt;
}

function logUnreceiptedGreen(sessionId: string, receipt: GreenReceipt): void {
  if (receipt.kind !== "unreceipted") return;
  store.logEvent({ event: VERIFY_GREEN_UNRECEIPTED, session: sessionId, command: receipt.slice });
}

function markArming(stateFile: string, sessionId: string, slice: string | undefined, content: string): void {
  if (slice === undefined) return;
  const change = store.recordedStateValue(content, "auto_change");
  appendMarker(verdictsFileFor(stateFile), { kind: "arm", slice, session: sessionId, change });
}

function runMark(sessionId: string, remaining: readonly string[]): number {
  if (remaining.length < 1 || remaining.length > 2) throw new UsageError();
  const [word, waveSlice] = remaining as [string, string | undefined];
  const mark = SLICE_MARKS.find((value) => value === word);
  if (mark === undefined) throw new RefusedError("mark", `${word} is not one of ${SLICE_MARKS.join(", ")}`);
  const stateFile = store.stateFileFor(process.cwd());
  const slice = waveSlice === undefined ? activeSliceIn(stateFile) : sliceOfArmedWave(stateFile, mark, waveSlice);
  if (slice === null) throw new RefusedError(`mark ${mark}`, "no slice is armed");
  const change = store.recordedStateValue(store.readFileIfPresent(stateFile, "skip") ?? "", "auto_change");
  appendMarker(verdictsFileFor(stateFile), { kind: mark, slice, session: sessionId, change });
  return 0;
}

function sliceOfArmedWave(stateFile: string, mark: string, slice: string): string {
  const wave = newestWave(readWaveLog(wavesFileFor(stateFile)));
  if (wave === undefined || !wave.slices.some((member) => member.slice === slice)) {
    throw new RefusedError(`mark ${mark}`, `slice ${slice} is not in the armed wave`);
  }
  return slice;
}

function runWave(sessionId: string, remaining: readonly string[]): number {
  const [subverb, wave, ...pairs] = remaining;
  if (subverb !== "start" || wave === undefined) throw new UsageError();
  const start = waveStartOf(wave, pairs);
  if ("refusal" in start) throw new RefusedError("wave start", start.refusal);
  const { members } = start;
  const stateFile = store.stateFileFor(process.cwd());
  mkdirSync(store.stateRootDirectory(), { recursive: true });
  return store.withLock(stateFile, sessionId, () => {
    const change = store.recordedStateValue(store.readFileIfPresent(stateFile, "skip") ?? "", "auto_change");
    if (!appendWave(wavesFileFor(stateFile), { wave, slices: members, session: sessionId, change })) {
      throw new RefusedError("wave start", "the wave record could not be written");
    }
    for (const { slice } of members) {
      appendMarker(verdictsFileFor(stateFile), { kind: "arm", slice, session: sessionId, change, wave });
    }
    return 0;
  });
}

function slicePairOf(pair: string): WaveSlice | undefined {
  const eq = pair.lastIndexOf("=");
  const slice = pair.slice(0, eq);
  const risk = SLICE_RISKS.find((value) => value === pair.slice(eq + 1));
  return eq < 1 || risk === undefined || !isSliceId(slice) ? undefined : { slice, risk };
}

function waveStartOf(wave: string, pairs: readonly string[]): Readonly<{ members: readonly WaveSlice[] }> | Readonly<{ refusal: string }> {
  if (!store.isNameToken(wave)) return { refusal: `${wave} is not a wave name` };
  if (pairs.length === 0) return { refusal: "a wave lists at least one <slice>=<low|high>" };
  const parsed = pairs.map(slicePairOf);
  const malformed = pairs[parsed.indexOf(undefined)];
  if (malformed !== undefined) return { refusal: `${malformed} is not <slice>=<low|high>` };
  const members = parsed.flatMap((member) => member ?? []);
  const repeated = members.find(({ slice }, index) => members.findIndex((other) => other.slice === slice) !== index);
  return repeated === undefined ? { members } : { refusal: `slice ${repeated.slice} is listed twice` };
}

function runLaunchToken(sessionId: string, remaining: readonly string[]): number {
  const [wave, token, ...slices] = remaining;
  if (wave === undefined || token === undefined) throw new UsageError();
  if (!store.isNameToken(token)) throw new RefusedError("launch-token", `${token} is not a token name`);
  const stateFile = store.stateFileFor(process.cwd());
  mkdirSync(store.stateRootDirectory(), { recursive: true });
  return store.withLock(stateFile, sessionId, () => {
    const wavesFile = wavesFileFor(stateFile);
    const log = readWaveLog(wavesFile);
    const armed = newestWaveNamed(log, wave);
    if (armed === undefined) throw new RefusedError("launch-token", `no ${wave} was started`);
    const refusal = launchTokenRefusal(log, armed, token, slices);
    if (refusal !== undefined) throw new RefusedError("launch-token", refusal);
    if (!appendLaunchToken(wavesFile, { wave, token, slices, session: sessionId })) {
      throw new RefusedError("launch-token", "the token could not be written");
    }
    return 0;
  });
}

function runReport(remaining: readonly string[]): number {
  const [flag, ...rest] = remaining;
  if (rest.length > 0 || (flag !== undefined && flag !== "--json")) throw new UsageError();
  const stateFile = store.stateFileFor(process.cwd());
  const metrics = verdictMetrics(readVerdicts(verdictsFileFor(stateFile)), readGreens(), activeSliceIn(stateFile));
  process.stdout.write(flag === "--json" ? `${JSON.stringify(metrics)}\n` : renderReportTable(metrics));
  return 0;
}

function activeSliceIn(stateFile: string): string | null {
  const slice = store.readValue(stateFile, "active_slice");
  return slice === undefined || slice === "" || slice === "none" ? null : slice;
}

function readGreens(): GreensRead {
  const eventsLog = store.eventsLogFile();
  const read = store.readStateFile(eventsLog);
  if (read.kind === "absent") return { kind: "omitted", reason: `no events log at ${eventsLog}` };
  if (read.kind === "unreadable") return { kind: "omitted", reason: `cannot read ${eventsLog}: ${read.cause}` };
  return { kind: "read", greens: unreceiptedGreensIn(read.content), integrationReds: integrationRedsIn(read.content) };
}

function runWatch(sessionId: string, remaining: readonly string[]): number {
  if (remaining.length > 0) throw new UsageError();
  const end = watchInFlight(store.stateFileFor(process.cwd()), sessionId);
  process.stdout.write(end.lines.map((line) => `${line}\n`).join(""));
  return end.exitCode;
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

function runClose(sessionId: string): number {
  const stateFile = store.stateFileFor(process.cwd());
  mkdirSync(store.stateRootDirectory(), { recursive: true });
  return store.withLock(stateFile, sessionId, () => {
    const read = store.readStateFile(stateFile);
    if (read.kind === "absent") return 0;
    if (read.kind === "unreadable") throw new store.StateFileUnreadableError(stateFile, read.cause);
    const owner = store.foreignOwner(read.content, sessionId);
    if (owner !== undefined) throw new RefusedError("close", `the state is owned by session ${owner}, not ${sessionId}`);
    store.removeStateKeys(stateFile, read.content, knownKeys.KEYS_CLOSE_REMOVES);
    store.logEvent({ event: "close", session: sessionId });
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
      throw new RefusedError(`close-slice ${sliceId}`, `active_slice is ${activeSlice}, not ${sliceId}`);
    }
    store.refuseGateWritesByAForeignSession(stateFile, sessionId);
    const patch = transitions.closeSlice();
    const receipt = receiptOfGreen(stateFile, `close-slice ${sliceId}`, sliceId, new Map(Object.entries(patch)));
    store.writeStatePairs(
      stateFile,
      Object.entries(patch).map(([key, value]) => `${key}=${value}`),
      sessionId,
    );
    store.logEvent({ event: "close-slice", session: sessionId, command: sliceId });
    logUnreceiptedGreen(sessionId, receipt);
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

function sanitizeSession(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9-]/g, "");
}
