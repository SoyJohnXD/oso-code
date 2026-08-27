import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  GATE_ROWS,
  HOST_ROWS,
  RECOVERY_ROWS,
  TOOL_ROWS,
  type GateRow,
  type HostRow,
  type PerHost,
  type RecoveryRow,
  type ToolRow,
} from "../../src/routes/routes.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";

const HOOK_GATES_TABLE = "tools/hook-gates.txt";

const tableRows = readFileSync(path.join(repositoryRoot, HOOK_GATES_TABLE), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"));

const hostNames = tableRows.filter((row) => row.startsWith("host ")).map((row) => cellsOf(row)[1] as string);

provedSomething(
  `${HOOK_GATES_TABLE} still parses into rows this check can compare`,
  tableRows.length > 0 && hostNames.length > 0,
  `${HOOK_GATES_TABLE} parsed into ${tableRows.length} row(s) and ${hostNames.length} host(s), so this check compared nothing`,
);

describe(`core/src/routes/routes.ts carries exactly what ${HOOK_GATES_TABLE} spells, while both exist`, () => {
  test("the host rows match", () => {
    assert.deepEqual(HOST_ROWS, rowsOfKind("host").map(hostRowOf));
  });

  test("the gate rows match", () => {
    assert.deepEqual([...GATE_ROWS] as GateRow[], rowsOfKind("gate").map(gateRowOf));
  });

  test("the recovery rows match", () => {
    assert.deepEqual(RECOVERY_ROWS, rowsOfKind("recovery").map(recoveryRowOf));
  });

  test("the tool rows match", () => {
    assert.deepEqual(TOOL_ROWS, rowsOfKind("tool").map(toolRowOf));
  });
});

function cellsOf(row: string): string[] {
  return row.split(/\s+/);
}

function rowsOfKind(kind: string): string[] {
  return tableRows.filter((row) => row.startsWith(`${kind} `));
}

function perHost(cells: readonly string[], offset: number): PerHost<string> {
  const named = hostNames.map((host, index) => [host, cells[offset + index] as string] as const);
  return Object.fromEntries(named) as PerHost<string>;
}

function hostRowOf(row: string): HostRow {
  const cells = cellsOf(row);
  return {
    host: cells[1] as HostRow["host"],
    manifest: cells[2] as string,
    commandRoot: cells.slice(3).join(" "),
  };
}

function gateRowOf(row: string): GateRow {
  const cells = cellsOf(row);
  return {
    gate: cells[1] as string,
    event: cells[2] as string,
    script: cells[3] as string,
    wiring: perHost(cells, 4) as GateRow["wiring"],
    mechanism: perHost(cells, 4 + hostNames.length),
  };
}

function recoveryRowOf(row: string): RecoveryRow {
  const rest = row.slice("recovery".length).trim();
  const boundary = rest.indexOf(" ");
  return { gate: rest.slice(0, boundary), route: rest.slice(boundary).trim() };
}

function toolRowOf(row: string): ToolRow {
  const cells = cellsOf(row);
  return {
    gate: cells[1] as string,
    names: perHost(cells, 2),
    capability: cells[2 + hostNames.length] as ToolRow["capability"],
    mandated: cells[3 + hostNames.length] as ToolRow["mandated"],
  };
}
