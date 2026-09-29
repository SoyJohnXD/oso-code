import type { GateOutcome, HookEnvelope, SessionStartVerdict } from "../hosts/envelope.ts";
import { readJsonFile } from "../install/json.ts";
import { opencodePathsFor } from "../install/opencode.ts";
import { openCodeHostProbes } from "../install/opencode-host.ts";
import { openCodeInstallTargets, type OpenCodeInstallRecord } from "../install/opencode-install.ts";
import { openCodeTrustTargetUnder } from "../install/opencode-trust.ts";
import { meetsVersionFloor, SUPPORTED_OPENCODE_VERSION } from "../install/pins.ts";
import { messageOf } from "../install/report.ts";
import { trustRowDivergences } from "../install/trust.ts";
import { homeDirectoryFrom, type LoggedEvent } from "../state/store.ts";

const REINSTALL = "reinstall with `oso install --host opencode --yes` from the oso-code checkout";

type DriftCheck =
  | Readonly<{ kind: "intact" }>
  | Readonly<{ kind: "drifted"; advice: string }>
  | Readonly<{ kind: "unchecked"; event: string; cause: string }>;

type InstallRecordReading =
  | Readonly<{ kind: "read"; record: OpenCodeInstallRecord }>
  | Readonly<{ kind: "unread"; cause: string }>;

const INTACT: DriftCheck = { kind: "intact" };

export function judgeOpenCodeDrift(envelope: HookEnvelope): GateOutcome<SessionStartVerdict> {
  const paths = opencodePathsFor(homeDirectoryFrom(process.platform, process.env), process.env);
  const reading = installRecordReading(openCodeInstallTargets(paths).installRecord);
  const checks =
    reading.kind === "unread"
      ? [unchecked("opencode-install-record-unread", reading.cause)]
      : [versionDrift(reading.record), trustedFileDrift(reading.record, paths.configHome), cliDrift()];
  return outcomeOf(checks, envelope.sessionId);
}

function installRecordReading(installRecord: string): InstallRecordReading {
  let parsed: unknown;
  try {
    parsed = readJsonFile(installRecord);
  } catch (error) {
    return { kind: "unread", cause: messageOf(error) };
  }
  if (parsed === undefined) return { kind: "unread", cause: `no install record at ${installRecord}` };
  if (!isInstallRecord(parsed)) return { kind: "unread", cause: `the install record at ${installRecord} holds no version and manifest rows` };
  return { kind: "read", record: parsed };
}

function isInstallRecord(parsed: unknown): parsed is OpenCodeInstallRecord {
  const candidate = parsed as { version?: unknown; manifest?: unknown } | null;
  if (typeof candidate?.version !== "string" || !Array.isArray(candidate.manifest)) return false;
  return candidate.manifest.every((row: { digest?: unknown; file?: unknown } | null) => typeof row?.digest === "string" && typeof row.file === "string");
}

function versionDrift(record: OpenCodeInstallRecord): DriftCheck {
  const running = process.env.OSO_HARNESS_BUILD_VERSION;
  if (running === undefined || running === "") return unchecked("opencode-build-version-unknown", "this plugin build embeds no harness version");
  if (running === record.version) return INTACT;
  return drifted(
    `oso-code: the installed OpenCode harness is version ${record.version} but the running plugin build is ${running} — ` +
      `tell the user once: ${REINSTALL}.`,
  );
}

function trustedFileDrift(record: OpenCodeInstallRecord, configHome: string): DriftCheck {
  const divergent = trustRowDivergences(record.manifest, (published) => openCodeTrustTargetUnder("installed", configHome, published));
  if (divergent.length === 0) return INTACT;
  return drifted(
    `oso-code: installed trusted file(s) no longer match the manifest they were installed from: ` +
      `${divergent.map((divergence) => divergence.file).join(", ")} — tell the user once: run \`oso verify --host opencode\`, then ${REINSTALL}.`,
  );
}

function cliDrift(): DriftCheck {
  const probed = openCodeHostProbes(process.env);
  if (probed.version === undefined) return unchecked("opencode-cli-unprobed", probed.versionNote ?? "no opencode on PATH");
  if (meetsVersionFloor(probed.version, SUPPORTED_OPENCODE_VERSION)) return INTACT;
  return drifted(
    `oso-code: this session runs OpenCode ${probed.version}, older than the supported ${SUPPORTED_OPENCODE_VERSION} — ` +
      `tell the user once: upgrade opencode to ${SUPPORTED_OPENCODE_VERSION} or newer.`,
  );
}

function outcomeOf(checks: readonly DriftCheck[], session: string): GateOutcome<SessionStartVerdict> {
  const advice = checks.flatMap((check) => (check.kind === "drifted" ? [check.advice] : []));
  const events = checks.flatMap((check): LoggedEvent[] => (check.kind === "unchecked" ? [{ event: check.event, session, command: check.cause }] : []));
  if (advice.length === 0) return { verdict: { kind: "allow" }, events };
  return { verdict: { kind: "context", additionalContext: advice.join(" ") }, events };
}

function drifted(advice: string): DriftCheck {
  return { kind: "drifted", advice };
}

function unchecked(event: string, cause: string): DriftCheck {
  return { kind: "unchecked", event, cause };
}
