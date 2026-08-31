const OK_PREFIX = "ok:   ";
const FAIL_PREFIX = "FAIL: ";
const NOTE_PREFIX = "note: ";
const SKIP_PREFIX = "skip: ";
const UNVERIFIED_PREFIX = "unverified: ";
const DETAIL_INDENT = "      ";
const SUMMARY_RULE = "----";

export class VerifyReport {
  private readonly lines: string[] = [];
  private passed = 0;
  private failed = 0;

  check(name: string, expected: string, actual: string, fix?: string): void {
    if (expected === actual) {
      this.lines.push(`${OK_PREFIX}${name} (${actual})`);
      this.passed += 1;
      return;
    }
    const fixSuffix = fix === undefined || fix === "" ? "" : ` — fix: ${fix}`;
    this.lines.push(`${FAIL_PREFIX}${name} — expected ${expected}, got ${actual}${fixSuffix}`);
    this.failed += 1;
  }

  note(text: string): void {
    this.lines.push(`${NOTE_PREFIX}${text}`);
  }

  skip(text: string): void {
    this.lines.push(`${SKIP_PREFIX}${text}`);
  }

  unverified(text: string): void {
    this.lines.push(`${UNVERIFIED_PREFIX}${text}`);
  }

  section(text: string): void {
    this.lines.push(text);
  }

  detail(text: string): void {
    this.lines.push(`${DETAIL_INDENT}${text}`);
  }

  get exitCode(): number {
    return this.failed === 0 ? 0 : 1;
  }

  render(): string {
    return [...this.lines, SUMMARY_RULE, `passed: ${this.passed}, failed: ${this.failed}`].map((line) => `${line}\n`).join("");
  }
}

export type CommandOutcome = Readonly<{ report: string; exitCode: number }>;

export type WiringEntry = Readonly<{ ok: boolean; component: string; note: string }>;

export function wiringOk(component: string, note: string): WiringEntry {
  return { ok: true, component, note };
}

export function wiringFail(component: string, note: string): WiringEntry {
  return { ok: false, component, note };
}

export function renderCommandReport(verb: string, host: string, infoLines: readonly string[], wiring: readonly WiringEntry[]): string {
  const summaryLines = wiring.map((entry) => `  ${entry.component}: ${entry.ok ? "OK" : "FAILED"} \u2014 ${entry.note}`);
  const failedCount = wiring.filter((entry) => !entry.ok).length;
  const lines = [
    `oso ${verb} --host ${host}`,
    ...infoLines,
    "wiring summary:",
    ...summaryLines,
    SUMMARY_RULE,
    `wired: ${wiring.length - failedCount}, failed: ${failedCount}`,
  ];
  return lines.map((line) => `${line}\n`).join("");
}

export function requiresYesOutcome(verb: string, host: string): CommandOutcome {
  return {
    report: `oso ${verb} --host ${host} requires --yes in this slice \u2014 no interactive confirmation prompt is wired yet\n`,
    exitCode: 1,
  };
}

export function usageErrorOutcome(verb: string, host: string, message: string): CommandOutcome {
  return { report: `oso ${verb} --host ${host}: ${message}\n`, exitCode: 2 };
}

export function fatalOutcome(verb: string, host: string, summary: string, detail: string, restoreNote = ""): CommandOutcome {
  return { report: `oso ${verb} --host ${host}: ${summary}: ${detail}${restoreNote}\n`, exitCode: 1 };
}

export function restoreNoteOf(restore: Readonly<{ failedCount: number; failedItems: readonly string[] }> | undefined): string {
  if (restore === undefined) return "";
  return restore.failedCount === 0
    ? " \u2014 rolled back to the pre-run snapshot"
    : ` \u2014 rollback incomplete: ${restore.failedItems.join(", ")} still need restoring by hand`;
}
