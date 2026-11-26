import { RECORDED_VERDICTS, type RecordedVerdict } from "./grammar.ts";
import { jsonObjectOf } from "../state/store.ts";
import {
  armingsOf,
  isMarkerOf,
  isVerifierRecord,
  type Marker,
  newestArmingOf,
  type VerdictLog,
  type VerdictLogEntry,
  type VerdictRecord,
  VERIFY_GREEN_UNRECEIPTED,
} from "./record.ts";

export type UnreceiptedGreen = Readonly<{ session: string }>;

export type IntegrationRed = Readonly<{ session: string; time: number }>;

export type GreensRead =
  | Readonly<{ kind: "read"; greens: readonly UnreceiptedGreen[]; integrationReds?: readonly IntegrationRed[] }>
  | Readonly<{ kind: "omitted"; reason: string }>;

export type ModelVerdicts = Readonly<{ model: string | null } & Record<RecordedVerdict, number>>;

export type ActiveSlice = Readonly<{
  slice: string;
  verdicts: readonly RecordedVerdict[];
  rounds: number;
  rounds_since_diagnosis: number | null;
}>;

export type RoundsSummary = Readonly<{ max: number; median: number }>;

export type ArmingClassMetrics = Readonly<{
  slices: number;
  first_fail_slices: number;
  first_fail_rate_percent: number | null;
  rounds_per_slice: RoundsSummary | null;
  wave_slices: number;
  escaped_slices: number;
  escape_rate_percent: number | null;
}>;

export type Escapes = Readonly<{ waves: number; batched_slices: number }> | Readonly<{ omitted: string }>;

export type VerdictMetrics = Readonly<{
  active_slice: ActiveSlice | null;
  wave_slices: readonly ActiveSlice[];
  slices: number;
  first_fail_slices: number;
  first_fail_rate_percent: number | null;
  rounds_per_slice: RoundsSummary | null;
  batched: ArmingClassMetrics;
  solo: ArmingClassMetrics;
  escapes: Escapes;
  recommendation: string;
  escalated_slices: number;
  verdicts_by_model: readonly ModelVerdicts[];
  malformed: number;
  skipped_lines: number;
  unreceipted_greens: Readonly<{ count: number }> | Readonly<{ omitted: string }>;
}>;

export function verdictMetrics(log: VerdictLog, greensRead: GreensRead, armedSlice: string | null): VerdictMetrics {
  const { everyArming, armMarkers } = armingsOf(log.entries);
  const roundsOfEachSlice = everyArming
    .map((arming) => arming.filter(isVerifierRecord))
    .filter((rounds) => rounds.length > 0);
  const verifierRecords = roundsOfEachSlice.flat();
  const firstFailSlices = roundsOfEachSlice.filter((rounds) => rounds[0]?.verdict === "fail").length;
  const reds = greensRead.kind === "read" ? (greensRead.integrationReds ?? []) : null;
  const armed = armedOutcomesOf(armMarkers, everyArming, reds ?? []);
  const batched = classMetrics(armed.filter((outcome) => outcome.batched));
  const solo = classMetrics(armed.filter((outcome) => !outcome.batched));
  const escapes = escapesOf(armed, greensRead);
  return {
    active_slice: activeSliceOf(log.entries, armedSlice),
    wave_slices: waveSlicesOf(log.entries, armMarkers, armedSlice),
    slices: roundsOfEachSlice.length,
    first_fail_slices: firstFailSlices,
    first_fail_rate_percent:
      roundsOfEachSlice.length === 0 ? null : oneDecimal((firstFailSlices * 100) / roundsOfEachSlice.length),
    rounds_per_slice: roundsSummary(roundsOfEachSlice.map((rounds) => rounds.length)),
    batched,
    solo,
    escapes,
    recommendation: recommendationOf(batched, solo, escapes),
    escalated_slices: everyArming.filter((arming) => arming.some((entry) => isMarkerOf("escalated", entry))).length,
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
    const { session, event } = jsonObjectOf(line) ?? {};
    return event === VERIFY_GREEN_UNRECEIPTED && typeof session === "string" ? [{ session }] : [];
  });
}

export function integrationRedsIn(eventsText: string): IntegrationRed[] {
  return eventsText.split("\n").flatMap((line) => {
    const { session, event, ts } = jsonObjectOf(line) ?? {};
    const time = typeof ts === "string" ? Date.parse(ts) : Number.NaN;
    return event === INTEGRATION_RED && typeof session === "string" && !Number.isNaN(time) ? [{ session, time }] : [];
  });
}

export function renderReportTable(metrics: VerdictMetrics): string {
  const rows: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["active slice", [activeSliceText(metrics)]],
    ["armed slices", [`${metrics.slices} with a verifier record`]],
    ["first-fail rate", [firstFailRateText(metrics)]],
    ["rounds per slice", [roundsText(metrics)]],
    ["escalated slices", [String(metrics.escalated_slices)]],
    ["verdicts by model", modelRowsText(metrics.verdicts_by_model)],
    ["malformed reports", [String(metrics.malformed)]],
    ["skipped lines", [String(metrics.skipped_lines)]],
    ["unreceipted greens", [unreceiptedGreensText(metrics)]],
    ...waveSliceRows(metrics),
    ["batched slices", [classText(metrics.batched)]],
    ["solo slices", [classText(metrics.solo)]],
    ["escapes", [escapesText(metrics.escapes)]],
    ["recommendation", [metrics.recommendation]],
  ];
  const labelWidth = Math.max(...rows.map(([label]) => label.length)) + 2;
  return rows
    .flatMap(([label, values]) => values.map((value, index) => `${(index === 0 ? label : "").padEnd(labelWidth)}${value}`))
    .map((line) => `${line}\n`)
    .join("");
}

const INTEGRATION_RED = "integration-red";

const MIN_BATCHED_SLICES = 20;

const RARE_ESCAPE_PERCENT = 10;

type ArmedOutcome = Readonly<{
  batched: boolean;
  rounds: number;
  firstVerdict: RecordedVerdict | null;
  wave: string | null;
  inRedWave: boolean;
}>;

function armedOutcomesOf(
  armMarkers: readonly Marker[],
  everyArming: readonly (readonly VerdictLogEntry[])[],
  reds: readonly IntegrationRed[],
): ArmedOutcome[] {
  const waveStarts = waveStartsOf(armMarkers);
  return everyArming.flatMap((arming, index) => {
    const rounds = arming.filter(isVerifierRecord);
    const first = rounds[0];
    if (first === undefined) return [];
    const marker = armMarkers[index]!;
    const wave = marker.wave === undefined ? null : waveKey(marker.session, marker.wave);
    return [
      {
        batched: (first.batch ?? 1) >= 2,
        rounds: rounds.length,
        firstVerdict: first.verdict,
        wave,
        inRedWave: wave !== null && reds.some((red) => waveOfRed(waveStarts, red) === wave),
      },
    ];
  });
}

function waveKey(session: string, wave: string): string {
  return `${session}\u0000${wave}`;
}

function waveStartsOf(armMarkers: readonly Marker[]): ReadonlyMap<string, number> {
  const starts = new Map<string, number>();
  for (const marker of armMarkers) {
    if (marker.wave === undefined) continue;
    const key = waveKey(marker.session, marker.wave);
    starts.set(key, Math.min(starts.get(key) ?? Number.POSITIVE_INFINITY, Date.parse(marker.time)));
  }
  return starts;
}

function waveOfRed(waveStarts: ReadonlyMap<string, number>, red: IntegrationRed): string | undefined {
  const candidates = [...waveStarts].filter(
    ([key, start]) => key.startsWith(`${red.session}\u0000`) && start <= red.time,
  );
  return candidates.sort(([, left], [, right]) => right - left)[0]?.[0];
}

function classMetrics(outcomes: readonly ArmedOutcome[]): ArmingClassMetrics {
  const firstFails = outcomes.filter((outcome) => outcome.firstVerdict === "fail").length;
  const inWave = outcomes.filter((outcome) => outcome.wave !== null);
  const escaped = inWave.filter((outcome) => outcome.inRedWave && outcome.firstVerdict === "pass").length;
  return {
    slices: outcomes.length,
    first_fail_slices: firstFails,
    first_fail_rate_percent: outcomes.length === 0 ? null : oneDecimal((firstFails * 100) / outcomes.length),
    rounds_per_slice: roundsSummary(outcomes.map((outcome) => outcome.rounds)),
    wave_slices: inWave.length,
    escaped_slices: escaped,
    escape_rate_percent: inWave.length === 0 ? null : oneDecimal((escaped * 100) / inWave.length),
  };
}

function escapesOf(armed: readonly ArmedOutcome[], greensRead: GreensRead): Escapes {
  if (greensRead.kind === "omitted") return { omitted: greensRead.reason };
  const escaped = armed.filter((outcome) => outcome.batched && outcome.inRedWave && outcome.firstVerdict === "pass");
  return { waves: new Set(escaped.map((outcome) => outcome.wave)).size, batched_slices: escaped.length };
}

function recommendationOf(batched: ArmingClassMetrics, solo: ArmingClassMetrics, escapes: Escapes): string {
  if (batched.slices < MIN_BATCHED_SLICES) {
    return `none — sample too small: ${batched.slices} of ${MIN_BATCHED_SLICES} batched slices needed`;
  }
  if ("omitted" in escapes) return "none — escapes cannot be counted without the events log";
  const batchedEscapes = batched.escape_rate_percent ?? 0;
  if (batchedEscapes > (solo.escape_rate_percent ?? 0)) {
    return batchedEscapes <= RARE_ESCAPE_PERCENT
      ? `lower batch to 2 — batched escapes are rare (${batchedEscapes.toFixed(1)} % <= ${RARE_ESCAPE_PERCENT} %) but above solo`
      : `revert — batched escape rate ${batchedEscapes.toFixed(1)} % is above ${RARE_ESCAPE_PERCENT} % and above solo`;
  }
  if ((batched.first_fail_rate_percent ?? 0) > (solo.first_fail_rate_percent ?? 0)) {
    return "lower batch to 2 — batched first-fail rate is above solo";
  }
  return "keep — batched first-fail and escape rates are not worse than solo";
}

function waveSlicesOf(
  entries: readonly VerdictLogEntry[],
  armMarkers: readonly Marker[],
  armedSlice: string | null,
): ActiveSlice[] {
  const armedMarker = armMarkers.filter((marker) => marker.slice === armedSlice).at(-1);
  if (armedMarker?.wave === undefined) return [];
  const members = armMarkers.filter(
    (marker) => marker.session === armedMarker.session && marker.wave === armedMarker.wave,
  );
  return members.flatMap((marker) => activeSliceOf(entries, marker.slice) ?? []);
}

function activeSliceOf(entries: readonly VerdictLogEntry[], armedSlice: string | null): ActiveSlice | null {
  if (armedSlice === null) return null;
  const arming = newestArmingOf(entries, armedSlice);
  const newestDiagnosis = arming.map((entry) => isMarkerOf("diagnosed", entry)).lastIndexOf(true);
  return {
    slice: armedSlice,
    verdicts: arming.filter(isVerifierRecord).map((record) => record.verdict),
    rounds: roundsIn(arming),
    rounds_since_diagnosis: newestDiagnosis === -1 ? null : roundsIn(arming.slice(newestDiagnosis + 1)),
  };
}

function roundsIn(entries: readonly VerdictLogEntry[]): number {
  return entries.filter((entry) => isVerifierRecord(entry) || isMarkerOf("empty-result", entry)).length;
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
  const armingSessions = new Set(
    entries.filter((entry) => isMarkerOf("arm", entry)).map((marker) => marker.session),
  );
  return greens.filter((green) => armingSessions.has(green.session)).length;
}

function waveSliceRows({ wave_slices: members }: VerdictMetrics): ReadonlyArray<readonly [string, readonly string[]]> {
  return members.map((member) => ["wave slice", [activeSliceText({ active_slice: member })]]);
}

function classText(metrics: ArmingClassMetrics): string {
  if (metrics.slices === 0) return "none";
  const failRate = `${(metrics.first_fail_rate_percent ?? 0).toFixed(1)} % first-fail (${metrics.first_fail_slices} of ${metrics.slices})`;
  const rounds = metrics.rounds_per_slice;
  return `${failRate}, rounds max ${rounds?.max ?? 0}, median ${rounds?.median ?? 0}`;
}

function escapesText(escapes: Escapes): string {
  if ("omitted" in escapes) return `omitted: ${escapes.omitted}`;
  return `${escapes.waves} waves with an integration red held ${escapes.batched_slices} batched-passed slices (conformance-finding escapes are not recorded)`;
}

function activeSliceText({ active_slice: active }: Pick<VerdictMetrics, "active_slice">): string {
  if (active === null) return "none — no slice is armed";
  const rounds = `${active.slice}: ${active.rounds} ${active.rounds === 1 ? "round" : "rounds"}`;
  const diagnosis =
    active.rounds_since_diagnosis === null ? "no diagnosis yet" : `${active.rounds_since_diagnosis} since diagnosis`;
  const verdicts =
    active.verdicts.length === 0 ? "no verifier verdict since its arming" : `verdicts ${active.verdicts.join(", ")}`;
  return `${rounds}, ${diagnosis}; ${verdicts}`;
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
