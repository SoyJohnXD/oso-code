import { readdirSync } from "node:fs";
import path from "node:path";
import { isRecord } from "./config-fields.ts";

type SessionPart = Readonly<Record<string, unknown>>;

function parsedPart(line: string): SessionPart | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;
  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const part = isRecord(event) ? event["part"] : undefined;
  return isRecord(part) ? part : {};
}

export function sessionParts(streamText: string): readonly SessionPart[] {
  const parts: SessionPart[] = [];
  for (const line of streamText.split("\n")) {
    const part = parsedPart(line);
    if (part !== undefined) parts.push(part);
  }
  return parts;
}

export function approvalToolAttempted(streamText: string, toolId: string): boolean {
  return sessionParts(streamText).some((part) => part["type"] === "tool" && part["tool"] === toolId);
}

export function approvalPromptAsked(stdout: string, stderr: string, toolId: string): boolean {
  const marker = `permission requested: ${toolId}`;
  return stdout.includes(marker) || stderr.includes(marker);
}

export type ApprovalPromptOutcome = "asked" | "not-asked";

export function approvalPromptOutcome(stdout: string, stderr: string, toolId: string): ApprovalPromptOutcome {
  return approvalPromptAsked(stdout, stderr, toolId) ? "asked" : "not-asked";
}

const APPROVED_PLAN_FILE_PATTERN = /^approved-.*\.md$/;

function approvedPlanArtifactCount(fixtureHome: string): number {
  const plansRoot = path.join(fixtureHome, ".local", "state", "oso-code", "plans");
  let entries: readonly string[];
  try {
    entries = readdirSync(plansRoot, { recursive: true, encoding: "utf8" });
  } catch {
    return 0;
  }
  return entries.filter((entry) => APPROVED_PLAN_FILE_PATTERN.test(path.basename(entry))).length;
}

export type ApprovedPlanArtifacts = "none" | `present:${number}`;

export function approvedPlanArtifacts(fixtureHome: string): ApprovedPlanArtifacts {
  const count = approvedPlanArtifactCount(fixtureHome);
  return count === 0 ? "none" : `present:${count}`;
}

export type SessionDeliveryOrder = "no-session" | "no-tool-call" | "text-then-tool" | "tool-first";

function nonEmptyRecord(value: unknown): SessionPart | undefined {
  return isRecord(value) && Object.keys(value).length > 0 ? value : undefined;
}

function emissionStart(part: SessionPart): number | undefined {
  const state = part["state"];
  const nestedTime = isRecord(state) ? state["time"] : undefined;
  const timing = nonEmptyRecord(part["time"]) ?? nonEmptyRecord(nestedTime);
  const start = timing?.["start"];
  return typeof start === "number" ? start : undefined;
}

function messageIdOf(part: SessionPart): string {
  const messageId = part["messageID"];
  return typeof messageId === "string" ? messageId : "";
}

function earliestStartPerMessage(parts: readonly SessionPart[]): ReadonlyMap<string, number> {
  const earliest = new Map<string, number>();
  for (const part of parts) {
    const started = emissionStart(part);
    if (started === undefined) continue;
    const messageId = messageIdOf(part);
    const current = earliest.get(messageId);
    earliest.set(messageId, current === undefined ? started : Math.min(current, started));
  }
  return earliest;
}

function anyTextStartedFirst(toolParts: readonly SessionPart[], textStarts: ReadonlyMap<string, number>): boolean {
  return toolParts.some((tool) => {
    const toolStarted = emissionStart(tool);
    const textStarted = textStarts.get(messageIdOf(tool));
    return toolStarted !== undefined && textStarted !== undefined && textStarted < toolStarted;
  });
}

export function sameTurnDeliveryOrder(streamText: string): SessionDeliveryOrder {
  const parts = sessionParts(streamText);
  if (parts.length === 0) return "no-session";
  const toolParts = parts.filter((part) => part["type"] === "tool");
  if (toolParts.length === 0) return "no-tool-call";
  const textStarts = earliestStartPerMessage(parts.filter((part) => part["type"] === "text"));
  return anyTextStartedFirst(toolParts, textStarts) ? "text-then-tool" : "tool-first";
}
