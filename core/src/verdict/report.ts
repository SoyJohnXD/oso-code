import { pairsOfSetEvent } from "../state/store.ts";
import { RECORDED_VERDICTS, type RecordedVerdict } from "./grammar.ts";
import {
  type ArmMarker,
  isArmMarker,
  jsonLineObject,
  recordsSinceArm,
  type VerdictLog,
  type VerdictLogEntry,
  type VerdictRecord,
  VERIFIER_ROLE,
} from "./record.ts";

export type Green = Readonly<{ session: string; time: string }>;

export type GreensRead =
  | Readonly<{ kind: "read"; greens: readonly Green[] }>
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

export function greensIn(eventsText: string): Green[] {
  return eventsText.split("\n").flatMap((line) => {
    const event = jsonLineObject(line);
    const { session, ts, event: name } = event ?? {};
    if (typeof session !== "string" || typeof ts !== "string" || typeof name !== "string") return [];
    return pairsOfSetEvent(name).includes("verify_green=true") ? [{ session, time: ts }] : [];
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

function recordsBySlice(records: readonly VerdictRecord[]): Map<string, VerdictRecord[]> {
  const bySlice = new Map<string, VerdictRecord[]>();
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

function unreceiptedGreenCount(entries: readonly VerdictLogEntry[], greens: readonly Green[]): number {
  return greens.filter((green) => {
    const arming = newestArmingOf(entries, green);
    return arming !== undefined && !passRecordedWithin(entries, arming, green);
  }).length;
}

function newestArmingOf(entries: readonly VerdictLogEntry[], green: Green): ArmMarker | undefined {
  return entries
    .filter(isArmMarker)
    .filter((marker) => marker.session === green.session && marker.time <= green.time)
    .at(-1);
}

function passRecordedWithin(entries: readonly VerdictLogEntry[], arming: ArmMarker, green: Green): boolean {
  return entries.some(
    (entry) =>
      !isArmMarker(entry) &&
      entry.role === VERIFIER_ROLE &&
      entry.verdict === "pass" &&
      entry.slice === arming.slice &&
      entry.time >= arming.time &&
      entry.time <= green.time,
  );
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
