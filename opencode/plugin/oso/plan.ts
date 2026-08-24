import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { recordTrace } from "./trace.ts";
import { messageOf } from "./wave.ts";

export interface CaptureResult {
  digest: string;
  presented: string;
}

export interface ApproveResult {
  ok: boolean;
  error?: string;
}

const MARKER_PREFIX = "<!-- oso-session: ";
const MARKER_SUFFIX = " -->";

export function digestOf(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function stateRoot(): string {
  const override = process.env.OSO_STATE_DIR;
  if (override !== undefined && override !== "") {
    return override;
  }
  return join(homedir(), ".local", "state", "oso-code");
}

export function repoStateDir(commonDir: string): string {
  return join(stateRoot(), "plans", digestOf(commonDir));
}

function markerLine(sessionID: string): string {
  return `${MARKER_PREFIX}${sessionID}${MARKER_SUFFIX}`;
}

function markerSession(content: string): string | null {
  const first = content.split("\n", 1)[0] ?? "";
  if (!first.startsWith(MARKER_PREFIX) || !first.endsWith(MARKER_SUFFIX)) {
    return null;
  }
  return first.slice(MARKER_PREFIX.length, first.length - MARKER_SUFFIX.length);
}

export function capturePlan(
  commonDir: string,
  sessionID: string,
  planDocument: string,
): CaptureResult {
  const digest = digestOf(planDocument);
  const dir = repoStateDir(commonDir);
  const presented = join(dir, `presented-${digest}.md`);
  const content = `${markerLine(sessionID)}\n${planDocument}`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(presented, content, { mode: 0o600 });
    writeFileSync(join(dir, "current.md"), content, { mode: 0o600 });
  } catch (err) {
    recordTrace({
      origin: "plan.capture",
      detail: `the plan snapshot is incomplete, so approval will refuse it: ${messageOf(err)}`,
      severity: "advisory",
      sessionID,
    });
  }
  return { digest, presented };
}

export function approvePlan(
  commonDir: string,
  digest: string,
  sessionID: string,
): ApproveResult {
  const dir = repoStateDir(commonDir);
  const presented = join(dir, `presented-${digest}.md`);
  let presentedContent: string;
  try {
    presentedContent = readFileSync(presented, "utf8");
  } catch {
    return { ok: false, error: "No pending plan for this session; present the plan before approving." };
  }
  if (markerSession(presentedContent) !== sessionID) {
    return { ok: false, error: "This session has no pending plan to approve." };
  }
  let currentContent: string;
  try {
    currentContent = readFileSync(join(dir, "current.md"), "utf8");
  } catch {
    return { ok: false, error: "the pending plan changed since it was presented; capture it again before approving" };
  }
  if (currentContent !== presentedContent) {
    return { ok: false, error: "the pending plan changed since it was presented; capture it again before approving" };
  }
  try {
    renameSync(presented, join(dir, `approved-${digest}.md`));
  } catch {
    return { ok: false, error: "The plan could not be approved; present it again before asking for approval." };
  }
  return { ok: true };
}
