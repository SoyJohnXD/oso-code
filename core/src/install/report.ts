const OK_PREFIX = "ok:   ";
const FAIL_PREFIX = "FAIL: ";
const NOTE_PREFIX = "note: ";
const SKIP_PREFIX = "skip: ";
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
