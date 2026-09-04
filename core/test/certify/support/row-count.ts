import { test, type TestContext } from "node:test";
import { CERTIFY_GUARD } from "./certify-guard.ts";

export const CONTRACT_BAR_ROWS_PORTED = 58;

let registered = 0;

export function contractBarRowsRegistered(): number {
  return registered;
}

export function contractBarRow(name: string, run: (t: TestContext) => void | Promise<void>): void {
  registered += 1;
  test(name, CERTIFY_GUARD, run);
}

export const BEHAVIOR_BAR_ROWS_PORTED = 11;

let behaviorRegistered = 0;

export function behaviorBarRowsRegistered(): number {
  return behaviorRegistered;
}

export function behaviorBarRow(name: string, run: (t: TestContext) => void | Promise<void>): void {
  behaviorRegistered += 1;
  test(name, CERTIFY_GUARD, run);
}

export const CODEX_SMOKE_ROWS_PORTED = 8;

let codexSmokeRegistered = 0;

export function codexSmokeRowsRegistered(): number {
  return codexSmokeRegistered;
}

export function codexSmokeRow(name: string, run: (t: TestContext) => void | Promise<void>): void {
  codexSmokeRegistered += 1;
  test(name, CERTIFY_GUARD, run);
}

export const WAVE_SMOKE_ROWS_PORTED = 10;

let waveSmokeRegistered = 0;

export function waveSmokeRowsRegistered(): number {
  return waveSmokeRegistered;
}

export function waveSmokeRow(name: string, run: (t: TestContext) => void | Promise<void>): void {
  waveSmokeRegistered += 1;
  test(name, CERTIFY_GUARD, run);
}
