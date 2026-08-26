import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import * as store from "./store.ts";

export class PlanFailure extends Error {}

export class PlanApprovalError extends Error {}

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
  const root = path.join(store.stateRootDirectory(), "plans");
  const dir = path.join(root, store.repositoryIdFor(stateFile));
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
  if (store.isSymlink(target)) throw new PlanFailure(`${symlinkLabel} is a symlink: ${target}`);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  if (!store.isDirectory(target)) throw new PlanFailure(`${directoryLabel} is not a directory: ${target}`);
}

export function runCapturePlan(cwd: string, sessionId: string, digest: string, document: string): number {
  if (!isValidPlanDigest(digest)) throw new PlanFailure("capture-plan requires one lowercase SHA-256 digest");
  const stateFile = store.stateFileFor(cwd);
  const paths = planPaths(stateFile, digest);
  ensurePlanDirectory(paths);
  if (document.length === 0) throw new PlanFailure("capture-plan requires a non-empty plan document on stdin");
  return store.withLock(stateFile, sessionId, () => {
    if (existsSync(paths.presentedFile)) {
      if (!store.isPrivateRegularFile(paths.presentedFile)) {
        throw new PlanFailure("presented snapshot is not a private regular file");
      }
      if (readFileSync(paths.presentedFile, "utf8") !== document) {
        throw new PlanFailure("presented snapshot content disagrees with its approval digest");
      }
    } else {
      store.writeFileAtomically(paths.dir, paths.presentedFile, document, ".snapshot.");
    }
    if (existsSync(paths.currentFile) && !store.isPrivateRegularFile(paths.currentFile)) {
      throw new PlanFailure("current plan is not a private regular file");
    }
    store.writeFileAtomically(paths.dir, paths.currentFile, document, ".current.");
    store.writeStatePairs(
      stateFile,
      [
        "mode=plan",
        "active_slice=none",
        "verify_green=false",
        "plan_approval=pending",
        `plan_approval_digest=${digest}`,
        `plan_approval_session=${sessionId}`,
        `plan_snapshot_file=${paths.presentedFile}`,
        `plan_current_file=${paths.currentFile}`,
        "plan_revision=0",
      ],
      sessionId,
    );
    store.logEvent({ event: "plan-artifact-captured", session: sessionId, command: digest });
    return 0;
  });
}

export function runApprovePlan(cwd: string, sessionId: string, digest: string): number {
  if (!isValidPlanDigest(digest)) {
    throw new PlanApprovalError("approve-plan requires one lowercase SHA-256 digest");
  }
  const stateFile = store.stateFileFor(cwd);
  mkdirSync(store.stateRootDirectory(), { recursive: true });
  return store.withLock(stateFile, sessionId, () => {
    if (!store.isReadableRegularFile(stateFile)) {
      throw new PlanApprovalError(`no readable pending plan approval for session ${sessionId}`);
    }
    if (store.readValue(stateFile, "plan_approval_session") !== sessionId) {
      throw new PlanApprovalError("pending plan approval belongs to another session");
    }
    if (store.readValue(stateFile, "mode") !== "plan") {
      throw new PlanApprovalError("pending approval is not attached to plan mode state");
    }
    if (store.readValue(stateFile, "plan_approval") !== "pending") {
      throw new PlanApprovalError("plan approval is not pending");
    }
    if (store.readValue(stateFile, "plan_approval_digest") !== digest) {
      throw new PlanApprovalError("pending plan digest changed before approval");
    }
    const paths = planPaths(stateFile, digest);
    ensurePlanDirectory(paths);
    if (store.readValue(stateFile, "plan_snapshot_file") !== paths.presentedFile) {
      throw new PlanFailure("pending state does not name the expected presented snapshot");
    }
    if (store.readValue(stateFile, "plan_current_file") !== paths.currentFile) {
      throw new PlanFailure("pending state does not name the expected current plan");
    }
    if (!store.isPrivateRegularFile(paths.currentFile)) {
      throw new PlanFailure("current plan is missing or unsafe");
    }
    if (store.isPrivateRegularFile(paths.presentedFile)) {
      if (readFileSync(paths.currentFile, "utf8") !== readFileSync(paths.presentedFile, "utf8")) {
        throw new PlanFailure("the pending plan changed since it was presented; capture it again before approving");
      }
      if (existsSync(paths.approvedFile)) {
        if (!store.isPrivateRegularFile(paths.approvedFile)) {
          throw new PlanFailure("approved snapshot is not a private regular file");
        }
        if (readFileSync(paths.presentedFile, "utf8") !== readFileSync(paths.approvedFile, "utf8")) {
          throw new PlanFailure("approved snapshot content disagrees with the pending document");
        }
        rmSync(paths.presentedFile, { force: true });
      } else {
        renameSync(paths.presentedFile, paths.approvedFile);
      }
    } else if (!store.isPrivateRegularFile(paths.approvedFile)) {
      throw new PlanFailure("presented plan snapshot is missing");
    }
    store.writeStatePairs(stateFile, ["plan_approval=approved", `plan_snapshot_file=${paths.approvedFile}`], sessionId);
    store.logEvent({ event: "plan-approval-approved", session: sessionId });
    return 0;
  });
}

export function runCancelPlan(cwd: string, sessionId: string, digest: string): number {
  if (!isValidPlanDigest(digest)) {
    throw new PlanApprovalError("cancel-plan requires one lowercase SHA-256 digest");
  }
  const stateFile = store.stateFileFor(cwd);
  mkdirSync(store.stateRootDirectory(), { recursive: true });
  return store.withLock(stateFile, sessionId, () => {
    if (!store.isReadableRegularFile(stateFile)) {
      throw new PlanApprovalError(`no readable pending plan approval for session ${sessionId}`);
    }
    if (store.readValue(stateFile, "plan_approval_session") !== sessionId) {
      throw new PlanApprovalError("pending plan approval belongs to another session");
    }
    if (store.readValue(stateFile, "plan_approval") !== "pending") {
      throw new PlanApprovalError("plan approval is not pending");
    }
    if (store.readValue(stateFile, "plan_approval_digest") !== digest) {
      throw new PlanApprovalError("pending plan digest changed before cancellation");
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
  if (!store.isNameToken(sliceId)) throw new PlanFailure("amend-plan requires a safe slice id");
  const stateFile = store.stateFileFor(cwd);
  mkdirSync(store.stateRootDirectory(), { recursive: true });
  if (document.length === 0) throw new PlanFailure("amend-plan requires a non-empty document on stdin");
  return store.withLock(stateFile, sessionId, () => {
    if (!store.isReadableRegularFile(stateFile)) {
      throw new PlanFailure(`no readable plan for session ${sessionId}`);
    }
    if (store.readValue(stateFile, "plan_approval_session") !== sessionId) {
      throw new PlanFailure("the plan belongs to another session");
    }
    if (store.readValue(stateFile, "mode") !== "plan") {
      throw new PlanFailure("amendments require active plan execution state");
    }
    const amendmentApproval = store.readValue(stateFile, "plan_approval");
    const shape = amendmentShapeFor(amendmentApproval);
    const approvalDigest = store.readValue(stateFile, "plan_approval_digest") ?? "";
    if (!isValidPlanDigest(approvalDigest)) throw new PlanFailure("the plan has no valid digest");
    const paths = planPaths(stateFile, approvalDigest);
    ensurePlanDirectory(paths);
    const amendmentSnapshotFile = amendmentApproval === "approved" ? paths.approvedFile : paths.presentedFile;
    if (store.readValue(stateFile, "plan_snapshot_file") !== amendmentSnapshotFile) {
      throw new PlanFailure("plan state does not name its expected immutable snapshot");
    }
    if (store.readValue(stateFile, "plan_current_file") !== paths.currentFile) {
      throw new PlanFailure("plan state does not name its operational plan");
    }
    if (!store.isPrivateRegularFile(amendmentSnapshotFile)) {
      throw new PlanFailure("the immutable snapshot is missing or unsafe");
    }
    if (!store.isPrivateRegularFile(paths.currentFile)) {
      throw new PlanFailure("current plan is missing or unsafe");
    }
    const revisionText = store.readValue(stateFile, "plan_revision") ?? "";
    if (!/^[0-9]+$/.test(revisionText)) throw new PlanFailure("current plan has no valid revision");
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

function amendmentShapeFor(approval: string | undefined): { heading: string; classification: string } {
  if (approval === "approved") return { heading: "Execution amendment", classification: "in-scope" };
  if (approval === "pending") return { heading: "Plan Mode feedback", classification: "feedback" };
  throw new PlanFailure("amendments require a pending or approved plan");
}
