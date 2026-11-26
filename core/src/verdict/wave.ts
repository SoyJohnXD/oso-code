import path from "node:path";
import { isoTimestamp, jsonObjectOf, readFileIfPresent, runsDirectoryOf } from "../state/store.ts";
import { appendJsonLine } from "./record.ts";

export const SLICE_RISKS = ["low", "high"] as const;

export type SliceRisk = (typeof SLICE_RISKS)[number];

export type WaveSlice = Readonly<{ slice: string; risk: SliceRisk }>;

export type WaveRecord = Readonly<{
  kind: "wave";
  wave: string;
  slices: readonly WaveSlice[];
  session: string;
  change: string | null;
  time: string;
}>;

export type LaunchToken = Readonly<{
  kind: "token";
  wave: string;
  token: string;
  slices: readonly string[];
  session: string;
  time: string;
}>;

export type WaveLog = Readonly<{ waves: readonly WaveRecord[]; tokens: readonly LaunchToken[] }>;

export const BATCH_MAX_SLICES = 3;

export function isBatchSize(sliceCount: number): boolean {
  return sliceCount >= 2;
}

export function wavesFileFor(stateFile: string): string {
  return path.join(runsDirectoryOf(stateFile), "waves.jsonl");
}

export function appendWave(wavesFile: string, wave: Omit<WaveRecord, "kind" | "time">): boolean {
  return appendJsonLine<WaveRecord>(wavesFile, wave.session, () => ({ kind: "wave", ...wave, time: isoTimestamp() }));
}

export function appendLaunchToken(wavesFile: string, token: Omit<LaunchToken, "kind" | "time">): boolean {
  return appendJsonLine<LaunchToken>(wavesFile, token.session, () => ({ kind: "token", ...token, time: isoTimestamp() }));
}

export function readWaveLog(wavesFile: string): WaveLog {
  const entries = (readFileIfPresent(wavesFile) ?? "")
    .split("\n")
    .filter((line) => line !== "")
    .flatMap((line) => {
      const entry = jsonObjectOf(line);
      return entry === undefined ? [] : [entry];
    });
  return {
    waves: entries.flatMap((entry) => waveOf(entry) ?? []),
    tokens: entries.flatMap((entry) => tokenOf(entry) ?? []),
  };
}

export function newestWaveNamed(log: WaveLog, wave: string): WaveRecord | undefined {
  return log.waves.filter((record) => record.wave === wave).at(-1);
}

export function newestWave(log: WaveLog): WaveRecord | undefined {
  return log.waves.at(-1);
}

export function launchTokenRefusal(log: WaveLog, wave: WaveRecord, token: string, slices: readonly string[]): string | undefined {
  if (slices.length === 0) return "a token lists at least one slice";
  if (log.tokens.some((registered) => registered.wave === wave.wave && registered.token === token)) {
    return `token ${token} is already registered`;
  }
  const repeated = slices.find((slice, index) => slices.indexOf(slice) !== index);
  if (repeated !== undefined) return `slice ${repeated} is listed twice`;
  const unknown = slices.find((slice) => !wave.slices.some((member) => member.slice === slice));
  if (unknown !== undefined) return `slice ${unknown} is not in ${wave.wave}`;
  if (slices.length === 1) return undefined;
  if (slices.length > BATCH_MAX_SLICES) return `a batch holds at most ${BATCH_MAX_SLICES} slices, not ${slices.length}`;
  const high = wave.slices.find((member) => member.risk === "high" && slices.includes(member.slice));
  return high === undefined ? undefined : `slice ${high.slice} is high risk and is verified solo`;
}

function waveOf(fields: Record<string, unknown>): WaveRecord | undefined {
  const { kind, wave, slices, session, change, time } = fields;
  if (kind !== "wave" || typeof wave !== "string" || typeof session !== "string" || typeof time !== "string") return undefined;
  if (change !== null && typeof change !== "string") return undefined;
  if (!Array.isArray(slices)) return undefined;
  const members = slices.flatMap((member: unknown) => recordedWaveSliceOf(member) ?? []);
  return members.length === slices.length ? { kind, wave, slices: members, session, change, time } : undefined;
}

function recordedWaveSliceOf(member: unknown): WaveSlice | undefined {
  if (typeof member !== "object" || member === null) return undefined;
  const { slice, risk } = member as Record<string, unknown>;
  const known = SLICE_RISKS.find((value) => value === risk);
  return typeof slice === "string" && known !== undefined ? { slice, risk: known } : undefined;
}

function tokenOf(fields: Record<string, unknown>): LaunchToken | undefined {
  const { kind, wave, token, slices, session, time } = fields;
  if (kind !== "token" || typeof wave !== "string" || typeof token !== "string") return undefined;
  if (typeof session !== "string" || typeof time !== "string") return undefined;
  if (!Array.isArray(slices) || !slices.every((slice) => typeof slice === "string")) return undefined;
  return { kind, wave, token, slices, session, time };
}
