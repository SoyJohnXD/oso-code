import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import * as store from "./store.ts";
import * as transitions from "./transitions.ts";

export class PlanFailure extends Error {
  readonly code: string | undefined;
  constructor(message: string, options?: ErrorOptions & { code?: string }) {
    super(message, options);
    this.code = options?.code;
  }
}

export class PlanApprovalError extends PlanFailure {}

export type PlanPresentationBinding = Readonly<{ version: 1; turnId: string; messageId: string; contentDigest: string }>;
type NativePlanApproval = Readonly<{ binding: PlanPresentationBinding; document: string }>;

export function matchesPlanPresentation(stateFile: string, binding: PlanPresentationBinding): boolean {
  return store.readValue(stateFile, "plan_presentation_version") === String(binding.version)
    && store.readValue(stateFile, "plan_presentation_turn") === binding.turnId
    && store.readValue(stateFile, "plan_presentation_message") === binding.messageId
    && store.readValue(stateFile, "plan_presentation_content_digest") === binding.contentDigest;
}

export class PlanVerifyFailure extends PlanFailure {
  readonly slice: string;
  constructor(slice: string) {
    super(`capture-plan requires slice ${slice} to name failing-check: or Verify-exception: on its Verify line`, { code: "missing-slice-verify" });
    this.slice = slice;
  }
}

export function runRejectPlanPresentation(cwd: string, sessionId: string, fingerprint: string): void {
  const stateFile = store.stateFileFor(cwd);
  mkdirSync(store.stateRootDirectory(), { recursive: true });
  store.withLock(stateFile, sessionId, () => {
    store.writeStatePairs(stateFile, [
      "mode=plan", "active_slice=", "verify_green=false", "plan_approval=pending",
      `plan_approval_session=${sessionId}`, "plan_presentation_status=failed",
      `plan_approval_digest=${store.readValue(stateFile, "plan_approval_digest") ?? fingerprint}`,
    ], sessionId);
  });
}

export function readPlanForReplacement(cwd: string, sessionId: string): string {
  const stateFile = store.stateFileFor(cwd);
  return store.withLock(stateFile, sessionId, () => {
    if (store.readValue(stateFile, "plan_approval_session") !== sessionId || store.readValue(stateFile, "plan_approval") !== "pending") throw new PlanFailure("replacement requires an own pending plan", { code: "replacement-not-pending" });
    const digest = store.readValue(stateFile, "plan_approval_digest") ?? "";
    if (!isValidPlanDigest(digest)) throw new PlanFailure("replacement requires a valid pending digest", { code: "invalid-pending-digest" });
    const paths = planPaths(stateFile, digest);
    if (store.readValue(stateFile, "plan_current_file") !== paths.currentFile || !store.isPrivateRegularFile(paths.currentFile)) throw new PlanFailure("preserved plan is missing or unsafe", { code: "preserved-plan-unsafe" });
    return readFileSync(paths.currentFile, "utf8");
  });
}

const PLAN_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function isValidPlanDigest(value: string): boolean {
  return PLAN_DIGEST_PATTERN.test(value);
}

type PlanPaths = {
  root: string;
  dir: string;
  presentedFile: string;
  approvedFile: string;
  currentFile: string;
};

function planPaths(stateFile: string, digest: string): PlanPaths {
  const root = store.planRootDirectory();
  const dir = store.planDirectoryKeyedBy(store.repositoryIdFor(stateFile));
  return {
    root,
    dir,
    presentedFile: path.join(dir, `presented-${digest}.md`),
    approvedFile: path.join(dir, `approved-${digest}.md`),
    currentFile: path.join(dir, "current.md"),
  };
}

function ensurePlanDirectory(paths: PlanPaths): void {
  requireNonSymlinkDirectory(store.stateRootDirectory(), "state root");
  requireNonSymlinkDirectory(paths.root, "plan root");
  requireNonSymlinkDirectory(paths.dir, "repository plan directory", "repository plan path");
  chmodSync(paths.root, 0o700);
  chmodSync(paths.dir, 0o700);
}

function requireNonSymlinkDirectory(target: string, symlinkLabel: string, directoryLabel: string = symlinkLabel): void {
  if (store.isSymlink(target)) throw new PlanFailure(`${symlinkLabel} is a symlink: ${target}`, { code: "plan-directory-symlink" });
  mkdirSync(target, { recursive: true, mode: 0o700 });
  if (!store.isDirectory(target)) throw new PlanFailure(`${directoryLabel} is not a directory: ${target}`, { code: "plan-directory-invalid" });
}

export function runCapturePlan(cwd: string, sessionId: string, digest: string, document: string, binding?: PlanPresentationBinding): number {
  if (!isValidPlanDigest(digest)) throw new PlanFailure("capture-plan requires one lowercase SHA-256 digest");
  const stateFile = store.stateFileFor(cwd);
  const paths = planPaths(stateFile, digest);
  ensurePlanDirectory(paths);
  if (document.length === 0) throw new PlanFailure("capture-plan requires a non-empty plan document on stdin");
  const uncheckedSlice = firstSliceNamingNoCheck(document);
  if (uncheckedSlice !== undefined) {
    throw new PlanVerifyFailure(uncheckedSlice);
  }
  return store.withLock(stateFile, sessionId, () => {
    if (binding !== undefined) {
      store.writeStatePairs(stateFile, ["mode=plan", "plan_approval=pending", "plan_presentation_status=failed", `plan_approval_session=${sessionId}`], sessionId);
    }
    if (existsSync(paths.presentedFile)) {
      if (!store.isPrivateRegularFile(paths.presentedFile)) {
        throw new PlanFailure("presented snapshot is not a private regular file", { code: "presented-snapshot-unsafe" });
      }
      if (readFileSync(paths.presentedFile, "utf8") !== document) {
        throw new PlanFailure("presented snapshot content disagrees with its approval digest", { code: "presented-snapshot-digest-mismatch" });
      }
    } else {
      store.writeFileAtomically(paths.dir, paths.presentedFile, document, ".snapshot.");
    }
    if (existsSync(paths.currentFile) && !store.isPrivateRegularFile(paths.currentFile)) {
      throw new PlanFailure("current plan is not a private regular file", { code: "current-plan-unsafe" });
    }
    store.writeFileAtomically(paths.dir, paths.currentFile, document, ".current.");
    const arming = transitions.armPlan();
    store.writeStatePairs(
      stateFile,
      [
        `mode=${arming.mode}`,
        `active_slice=${arming.active_slice}`,
        `verify_green=${arming.verify_green}`,
        "plan_approval=pending",
        `plan_approval_digest=${digest}`,
        `plan_approval_session=${sessionId}`,
        `plan_snapshot_file=${paths.presentedFile}`,
        `plan_current_file=${paths.currentFile}`,
        "plan_revision=0",
        ...(binding === undefined && store.readValue(stateFile, "plan_presentation_version") === undefined ? [] : [
          `plan_presentation_version=${binding?.version ?? ""}`,
          `plan_presentation_turn=${binding?.turnId ?? ""}`,
          `plan_presentation_message=${binding?.messageId ?? ""}`,
          `plan_presentation_content_digest=${binding?.contentDigest ?? ""}`,
          `plan_presentation_status=${binding === undefined ? "" : "captured"}`,
        ]),
      ],
      sessionId,
    );
    store.logEvent({ event: "plan-artifact-captured", session: sessionId, command: digest });
    return 0;
  });
}

export function runApprovePlan(cwd: string, sessionId: string, digest: string, nativePresentation?: () => NativePlanApproval): number {
  if (!isValidPlanDigest(digest)) {
    throw new PlanApprovalError("approve-plan requires one lowercase SHA-256 digest", { code: "invalid-approval-digest" });
  }
  const stateFile = store.stateFileFor(cwd);
  mkdirSync(store.stateRootDirectory(), { recursive: true });
  return store.withLock(stateFile, sessionId, () => {
    requireOwnApprovalState(stateFile, sessionId);
    if (store.readValue(stateFile, "mode") !== "plan") {
      throw new PlanApprovalError("pending approval is not attached to plan mode state", { code: "approval-not-plan-mode" });
    }
    requirePendingApproval(stateFile);
    if (store.readValue(stateFile, "plan_approval_digest") !== digest) {
      throw new PlanApprovalError("pending plan digest changed before approval", { code: "approval-digest-changed" });
    }
    let native: NativePlanApproval | undefined;
    if (nativePresentation !== undefined) {
      if (store.readValue(stateFile, "plan_presentation_status") !== "captured" || store.readValue(stateFile, "plan_presentation_version") !== "1") throw new PlanApprovalError("native presentation requires replacement capture", { code: "replacement-required" });
      native = nativePresentation();
      if (!matchesPlanPresentation(stateFile, native.binding)) throw new PlanApprovalError("a newer native presentation superseded the pending document", { code: "superseded-presentation" });
    }
    const paths = planPaths(stateFile, digest);
    ensurePlanDirectory(paths);
    if (store.readValue(stateFile, "plan_snapshot_file") !== paths.presentedFile) {
      throw new PlanFailure("pending state does not name the expected presented snapshot", { code: "presented-snapshot-binding-mismatch" });
    }
    if (store.readValue(stateFile, "plan_current_file") !== paths.currentFile) {
      throw new PlanFailure("pending state does not name the expected current plan", { code: "current-plan-binding-mismatch" });
    }
    if (!store.isPrivateRegularFile(paths.currentFile)) {
      throw new PlanFailure("current plan is missing or unsafe", { code: "current-plan-unsafe" });
    }
    if (native !== undefined && readFileSync(paths.currentFile, "utf8") !== native.document) throw new PlanApprovalError("native presentation differs from the pending document", { code: "pending-document-mismatch" });
    if (store.isPrivateRegularFile(paths.presentedFile)) {
      if (!byteIdentical(paths.currentFile, paths.presentedFile)) {
        throw new PlanFailure("the pending plan changed since it was presented; capture it again before approving", { code: "presented-document-mismatch" });
      }
      if (existsSync(paths.approvedFile)) {
        if (!store.isPrivateRegularFile(paths.approvedFile)) {
          throw new PlanFailure("approved snapshot is not a private regular file", { code: "approved-snapshot-unsafe" });
        }
        if (!byteIdentical(paths.presentedFile, paths.approvedFile)) {
          throw new PlanFailure("approved snapshot content disagrees with the pending document", { code: "approved-document-mismatch" });
        }
        rmSync(paths.presentedFile, { force: true });
      } else {
        renameSync(paths.presentedFile, paths.approvedFile);
      }
    } else if (!store.isPrivateRegularFile(paths.approvedFile)) {
      throw new PlanFailure("presented plan snapshot is missing", { code: "presented-snapshot-missing" });
    } else if (native !== undefined && !byteIdentical(paths.currentFile, paths.approvedFile)) {
      throw new PlanFailure("current plan differs from the partially published approved snapshot", { code: "partial-publication-mismatch" });
    }
    store.writeStatePairs(stateFile, ["plan_approval=approved", `plan_snapshot_file=${paths.approvedFile}`], sessionId);
    store.logEvent({ event: "plan-approval-approved", session: sessionId });
    return 0;
  });
}

export function runCancelPlan(cwd: string, sessionId: string, digest: string): number {
  if (!isValidPlanDigest(digest)) {
    throw new PlanApprovalError("cancel-plan requires one lowercase SHA-256 digest", { code: "invalid-cancellation-digest" });
  }
  const stateFile = store.stateFileFor(cwd);
  mkdirSync(store.stateRootDirectory(), { recursive: true });
  return store.withLock(stateFile, sessionId, () => {
    requireOwnApprovalState(stateFile, sessionId);
    requirePendingApproval(stateFile);
    if (store.readValue(stateFile, "plan_approval_digest") !== digest) {
      throw new PlanApprovalError("pending plan digest changed before cancellation", { code: "cancellation-digest-changed" });
    }
    const paths = planPaths(stateFile, digest);
    if (store.readValue(stateFile, "plan_snapshot_file") === paths.presentedFile) {
      rmSync(paths.presentedFile, { force: true });
    }
    if (store.readValue(stateFile, "plan_current_file") === paths.currentFile) {
      rmSync(paths.currentFile, { force: true });
    }
    store.clearStateFile(stateFile);
    store.logEvent({ event: "plan-approval-cancelled", session: sessionId });
    return 0;
  });
}

export function runAmendPlan(cwd: string, sessionId: string, sliceId: string, document: string): number {
  if (!store.isNameToken(sliceId)) throw new PlanFailure("amend-plan requires a safe slice id", { code: "invalid-amendment-slice" });
  const stateFile = store.stateFileFor(cwd);
  mkdirSync(store.stateRootDirectory(), { recursive: true });
  if (document.length === 0) throw new PlanFailure("amend-plan requires a non-empty document on stdin", { code: "empty-amendment" });
  return store.withLock(stateFile, sessionId, () => {
    if (!store.isReadableRegularFile(stateFile)) {
      throw new PlanFailure(`no readable plan for session ${sessionId}`, { code: "plan-state-unreadable" });
    }
    if (store.readValue(stateFile, "plan_approval_session") !== sessionId) {
      throw new PlanFailure("the plan belongs to another session", { code: "foreign-plan-session" });
    }
    if (store.readValue(stateFile, "mode") !== "plan") {
      throw new PlanFailure("amendments require active plan execution state", { code: "amendment-not-plan-mode" });
    }
    const amendmentApproval = store.readValue(stateFile, "plan_approval");
    const shape = amendmentShapeFor(amendmentApproval);
    const approvalDigest = store.readValue(stateFile, "plan_approval_digest") ?? "";
    if (!isValidPlanDigest(approvalDigest)) throw new PlanFailure("the plan has no valid digest", { code: "invalid-plan-digest" });
    const paths = planPaths(stateFile, approvalDigest);
    ensurePlanDirectory(paths);
    const amendmentSnapshotFile = amendmentApproval === "approved" ? paths.approvedFile : paths.presentedFile;
    if (store.readValue(stateFile, "plan_snapshot_file") !== amendmentSnapshotFile) {
      throw new PlanFailure("plan state does not name its expected immutable snapshot", { code: "immutable-snapshot-binding-mismatch" });
    }
    if (store.readValue(stateFile, "plan_current_file") !== paths.currentFile) {
      throw new PlanFailure("plan state does not name its operational plan", { code: "current-plan-binding-mismatch" });
    }
    if (!store.isPrivateRegularFile(amendmentSnapshotFile)) {
      throw new PlanFailure("the immutable snapshot is missing or unsafe", { code: "immutable-snapshot-unsafe" });
    }
    if (!store.isPrivateRegularFile(paths.currentFile)) {
      throw new PlanFailure("current plan is missing or unsafe", { code: "current-plan-unsafe" });
    }
    const revisionText = store.readValue(stateFile, "plan_revision") ?? "";
    if (!/^[0-9]+$/.test(revisionText)) throw new PlanFailure("current plan has no valid revision", { code: "invalid-plan-revision" });
    const nextRevision = Number(revisionText) + 1;
    const amended =
      `${readFileSync(paths.currentFile, "utf8")}\n\n## ${shape.heading} — ${sliceId}\n\n` +
      `- Added-at: ${store.isoTimestamp()}\n- Requested-by: operator\n- Classification: ${shape.classification}\n\n` +
      `${document}\n`;
    store.writeFileAtomically(paths.dir, paths.currentFile, amended, ".amended.");
    store.writeStatePairs(stateFile, [`plan_revision=${nextRevision}`, "verify_green=false"], sessionId);
    store.logEvent({ event: "plan-amended", session: sessionId, command: sliceId });
    return 0;
  });
}

function requireOwnApprovalState(stateFile: string, sessionId: string): void {
  if (!store.isReadableRegularFile(stateFile)) {
    throw new PlanApprovalError(`no readable pending plan approval for session ${sessionId}`, { code: "pending-state-unreadable" });
  }
  if (store.readValue(stateFile, "plan_approval_session") !== sessionId) {
    throw new PlanApprovalError("pending plan approval belongs to another session", { code: "foreign-approval-session" });
  }
}

function requirePendingApproval(stateFile: string): void {
  if (store.readValue(stateFile, "plan_approval") !== "pending") {
    throw new PlanApprovalError("plan approval is not pending", { code: "approval-not-pending" });
  }
}

function byteIdentical(leftFile: string, rightFile: string): boolean {
  return readFileSync(leftFile).equals(readFileSync(rightFile));
}

function amendmentShapeFor(approval: string | undefined): { heading: string; classification: string } {
  if (approval === "approved") return { heading: "Execution amendment", classification: "in-scope" };
  if (approval === "pending") return { heading: "Plan Mode feedback", classification: "feedback" };
  throw new PlanFailure("amendments require a pending or approved plan", { code: "amendment-not-active" });
}

const VERIFY_CHECK_TOKENS = ["failing-check:", "Verify-exception:"] as const;
const THE_FIELD_ONLY_A_SLICE_BLOCK_CARRIES = "Depends-on";
const MARKDOWN_LIST_OR_HEADING = /^[\s>]*(?:#{1,6}\s+)?(?:[-*+]\s+|\d+[.)]\s+)?(?:\[[ xX]\]\s+)?/;
const MARKDOWN_EMPHASIS = /^[*_]{1,3}/;
const SLICE_LABEL = /^(S\d+|Slice\s+\d+)(?:\s+[A-Z]{2,})*(?:\s*\([^)]*\))?\s*[—–:-]/;
const MARKDOWN_HEADING = /^[\s>]*(#{1,6})\s+/;

type SliceBlock = Readonly<{ label: string; text: string }>;
type OpenSlice = { label: string; boundaryLevel: number; lines: string[] };

function firstSliceNamingNoCheck(document: string): string | undefined {
  return sliceBlocksIn(document).find(({ text }) => !namesAVerifyCheck(text))?.label;
}

function sliceBlocksIn(document: string): SliceBlock[] {
  const opened: OpenSlice[] = [];
  let current: OpenSlice | undefined;
  let currentHeadingLevel: number | undefined;
  for (const line of document.split("\n")) {
    const label = sliceLabelOpening(line);
    if (label !== undefined) {
      const headingLevel = headingLevelOf(line);
      current = {
        label,
        boundaryLevel: headingLevel ?? currentHeadingLevel ?? 6,
        lines: [line],
      };
      opened.push(current);
      if (headingLevel !== undefined) currentHeadingLevel = headingLevel;
      continue;
    }
    const headingLevel = headingLevelOf(line);
    if (current !== undefined && headingLevel !== undefined && headingLevel <= current.boundaryLevel) current = undefined;
    current?.lines.push(line);
    if (headingLevel !== undefined) currentHeadingLevel = headingLevel;
  }
  return opened
    .map(({ label, lines }) => ({ label, text: lines.join("\n") }))
    .filter(({ text }) => text.includes(THE_FIELD_ONLY_A_SLICE_BLOCK_CARRIES));
}

function headingLevelOf(line: string): number | undefined {
  const heading = MARKDOWN_HEADING.exec(line);
  return heading === null ? undefined : heading[1]?.length;
}

function sliceLabelOpening(line: string): string | undefined {
  const undecorated = line.replace(MARKDOWN_LIST_OR_HEADING, "").replace(MARKDOWN_EMPHASIS, "");
  return SLICE_LABEL.exec(undecorated)?.[1];
}

function namesAVerifyCheck(blockText: string): boolean {
  const lowered = blockText.toLowerCase();
  return VERIFY_CHECK_TOKENS.some((token) => lowered.includes(token.toLowerCase()));
}
