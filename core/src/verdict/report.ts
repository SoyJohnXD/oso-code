import { RECORDED_VERDICTS, type RecordedVerdict } from "./grammar.ts";
import {
  isArmMarker,
  jsonLineObject,
  recordsSinceArm,
  type VerdictLog,
  type VerdictLogEntry,
  type VerdictRecord,
  VERIFIER_ROLE,
  VERIFY_GREEN_UNRECEIPTED,
} from "./record.ts";

export type UnreceiptedGreen = Readonly<{ session: string }>;

export type GreensRead =
  | Readonly<{ kind: "read"; greens: readonly UnreceiptedGreen[] }>
  | Readonly<{ kind: "omitted"; reason: string }>;

export type ModelVerdicts = Readonly<{ model: string | null } & Record<RecordedVerdict, number>>;

export type VerdictMetrics = Readonly<{
  slices: number;
  first_fail_slices: number;
  first_fail_rate_percent: number | null;
  rounds_per_slice: Readonly<{ max: number; median: number }> | null;
  verdicts_by_model: readonly ModelVerdicts[];
  malformed: number;
  skipped_lines: number;
  unreceipted_greens: Readonly<{ count: number }> | Readonly<{ omitted: string }>;
}>;

export function verdictMetrics(log: VerdictLog, greensRead: GreensRead): VerdictMetrics {
  const verifierRecords = recordsSinceArm(log.entries).filter((record) => record.role === VERIFIER_ROLE);
  const roundsOfEachSlice = [...recordsBySlice(verifierRecords).values()];
  const firstFailSlices = roundsOfEachSlice.filter((rounds) => rounds[0]?.verdict === "fail").length;
  return {
    slices: roundsOfEachSlice.length,
    first_fail_slices: firstFailSlices,
    first_fail_rate_percent:
      roundsOfEachSlice.length === 0 ? null : oneDecimal((firstFailSlices * 100) / roundsOfEachSlice.length),
    rounds_per_slice: roundsSummary(roundsOfEachSlice.map((rounds) => rounds.length)),
    verdicts_by_model: verdictsByModel(verifierRecords),
    malformed: verifierRecords.filter((record) => record.verdict_shape === "malformed").length,
    skipped_lines: log.skippedLines,
    unreceipted_greens:
      greensRead.kind === "omitted"
        ? { omitted: greensRead.reason }
        : { count: unreceiptedGreenCount(log.entries, greensRead.greens) },
  };
}

export function unreceiptedGreensIn(eventsText: string): UnreceiptedGreen[] {
  return eventsText.split("\n").flatMap((line) => {
    const { session, event } = jsonLineObject(line) ?? {};
    return event === VERIFY_GREEN_UNRECEIPTED && typeof session === "string" ? [{ session }] : [];
  });
}

export function renderReportTable(metrics: VerdictMetrics): string {
  const rows: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["armed slices", [`${metrics.slices} with a verifier record`]],
    ["first-fail rate", [firstFailRateText(metrics)]],
    ["rounds per slice", [roundsText(metrics)]],
    ["verdicts by model", modelRowsText(metrics.verdicts_by_model)],
    ["malformed reports", [String(metrics.malformed)]],
    ["skipped lines", [String(metrics.skipped_lines)]],
    ["unreceipted greens", [unreceiptedGreensText(metrics)]],
  ];
  const labelWidth = Math.max(...rows.map(([label]) => label.length)) + 2;
  return rows
    .flatMap(([label, values]) => values.map((value, index) => `${(index === 0 ? label : "").padEnd(labelWidth)}${value}`))
    .map((line) => `${line}\n`)
    .join("");
}

function recordsBySlice(records: readonly VerdictRecord[]): Map<string | null, VerdictRecord[]> {
  const bySlice = new Map<string | null, VerdictRecord[]>();
  for (const record of records) {
    bySlice.set(record.slice, [...(bySlice.get(record.slice) ?? []), record]);
  }
  return bySlice;
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundsSummary(rounds: readonly number[]): VerdictMetrics["rounds_per_slice"] {
  if (rounds.length === 0) return null;
  const sorted = [...rounds].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return { max: sorted.at(-1)!, median };
}

function verdictsByModel(records: readonly VerdictRecord[]): ModelVerdicts[] {
  const byModel = new Map<string | null, Record<RecordedVerdict, number>>();
  for (const record of records) {
    const counts = byModel.get(record.model) ?? zeroCounts();
    counts[record.verdict] += 1;
    byModel.set(record.model, counts);
  }
  return [...byModel].map(([model, counts]) => ({ model, ...counts }));
}

function zeroCounts(): Record<RecordedVerdict, number> {
  return Object.fromEntries(RECORDED_VERDICTS.map((verdict) => [verdict, 0])) as Record<RecordedVerdict, number>;
}

function unreceiptedGreenCount(entries: readonly VerdictLogEntry[], greens: readonly UnreceiptedGreen[]): number {
  const armingSessions = new Set(entries.filter(isArmMarker).map((marker) => marker.session));
  return greens.filter((green) => armingSessions.has(green.session)).length;
}

function firstFailRateText(metrics: VerdictMetrics): string {
  if (metrics.first_fail_rate_percent === null) return "none — no armed slice holds a verifier record";
  return `${metrics.first_fail_rate_percent.toFixed(1)} % (${metrics.first_fail_slices} of ${metrics.slices} slices)`;
}

function roundsText({ rounds_per_slice: rounds }: VerdictMetrics): string {
  return rounds === null ? "none" : `max ${rounds.max}, median ${rounds.median}`;
}

function modelRowsText(models: readonly ModelVerdicts[]): string[] {
  if (models.length === 0) return ["none"];
  return models.map((counts) => {
    const tally = RECORDED_VERDICTS.map((verdict) => `${verdict} ${counts[verdict]}`).join(", ");
    return `${counts.model ?? "unknown"}: ${tally}`;
  });
}

function unreceiptedGreensText({ unreceipted_greens: greens }: VerdictMetrics): string {
  return "omitted" in greens ? `omitted: ${greens.omitted}` : String(greens.count);
}
