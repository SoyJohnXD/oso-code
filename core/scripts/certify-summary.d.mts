export interface CertifyNotRunRow {
  readonly row: string;
  readonly reason: string;
}

export interface CertifySuiteTap {
  readonly registered: number;
  readonly notRun: readonly CertifyNotRunRow[];
}

export interface CertifySuiteReport extends CertifySuiteTap {
  readonly suite: string;
  readonly host: string;
}

export interface CertifyHostTotal {
  registered: number;
  notRunCount: number;
  notRunLines: string[];
}

export const CERTIFY_SUITE_HOSTS: Readonly<Record<string, string>>;

export function parseCertifySuiteTap(tapText: string): CertifySuiteTap;
export function certifyHostTotals(suiteReports: readonly CertifySuiteReport[]): Map<string, CertifyHostTotal>;
export function hostDroveZeroRows(total: CertifyHostTotal): boolean;
export function renderCertifySummary(suiteReports: readonly CertifySuiteReport[]): string;
