import {
  EXECUTION_AMENDMENT_HEADING,
  MARKDOWN_HEADING,
  PLAN_MODE_FEEDBACK_HEADING,
  sliceLabelOpening,
} from "../state/plan.ts";
import { sha256Hex } from "../state/store.ts";

export class PlanDeltaError extends Error {}

type HeadingKey = Readonly<{ kind: "heading"; heading: string; occurrence: number }>;

export type PlanSectionKey =
  | Readonly<{ kind: "preamble" }>
  | HeadingKey
  | Readonly<{ kind: "slice"; section: HeadingKey; slice: string; occurrence: number }>;

export type LineChange = Readonly<{ change: "kept" | "added" | "removed"; line: string }>;

type AlignedFields = {
  key: PlanSectionKey;
  base: string;
  next: string;
  basePosition: number;
  nextPosition: number;
  moved: boolean;
};

export type PlanDeltaSegment = Readonly<
  | ({ kind: "unchanged" } & AlignedFields)
  | ({ kind: "changed" | "format-only"; lines: readonly LineChange[] } & AlignedFields)
  | { kind: "added"; key: PlanSectionKey; next: string; nextPosition: number }
  | { kind: "removed"; key: PlanSectionKey; base: string; basePosition: number }
>;

type AmendmentHeading = typeof EXECUTION_AMENDMENT_HEADING | typeof PLAN_MODE_FEEDBACK_HEADING;

export type DroppedAmendment = Readonly<{ heading: AmendmentHeading; sliceId: string; text: string }>;

export type PlanDelta = Readonly<{
  segments: readonly PlanDeltaSegment[];
  droppedAmendments: readonly DroppedAmendment[];
}>;

export function planDeltaOf({ base, next, current }: { base: string; next: string; current?: string }): PlanDelta {
  if (base.length === 0) throw new PlanDeltaError("plan delta requires a non-empty base document");
  if (next.length === 0) throw new PlanDeltaError("plan delta requires a non-empty next document");
  return {
    segments: alignedSegments(sectionsOf(base), sectionsOf(next)),
    droppedAmendments: amendmentsIn(current ?? "").filter(({ text }) => !next.includes(text)),
  };
}

export function renderPlanDelta(delta: PlanDelta): string {
  return [...segmentReport(delta.segments), ...droppedAmendmentReport(delta.droppedAmendments), ""].join("\n");
}

export function planDeltaDigestOf(delta: PlanDelta): string {
  return sha256Hex(renderPlanDelta(delta));
}

export function baseDocumentOf(delta: PlanDelta): string {
  return delta.segments
    .flatMap((segment) => (segment.kind === "added" ? [] : [segment]))
    .sort((left, right) => left.basePosition - right.basePosition)
    .map(({ base }) => base)
    .join("");
}

export function nextDocumentOf(delta: PlanDelta): string {
  return delta.segments
    .flatMap((segment) => (segment.kind === "removed" ? [] : [segment]))
    .sort((left, right) => left.nextPosition - right.nextPosition)
    .map(({ next }) => next)
    .join("");
}

type PlanSection = Readonly<{ key: PlanSectionKey; alignmentId: string; body: string }>;

const LINE_WITH_TERMINATOR = /[^\n]*\n|[^\n]+$/g;

function sectionsOf(document: string): PlanSection[] {
  const sections: { key: PlanSectionKey; body: string }[] = [];
  const occurrences = new Map<string, number>();
  const nextOccurrence = (scope: unknown[]): number => {
    const scopeId = JSON.stringify(scope);
    const occurrence = (occurrences.get(scopeId) ?? 0) + 1;
    occurrences.set(scopeId, occurrence);
    return occurrence;
  };
  let enclosing: HeadingKey | undefined;
  for (const line of document.match(LINE_WITH_TERMINATOR) ?? []) {
    const heading = headingTextOf(line);
    const slice = sliceLabelOpening(line);
    if (heading !== undefined) {
      const name = slice ?? heading;
      enclosing = { kind: "heading", heading: name, occurrence: nextOccurrence([name]) };
      sections.push({ key: enclosing, body: line });
    } else if (slice !== undefined && enclosing !== undefined) {
      const occurrence = nextOccurrence([enclosing.heading, enclosing.occurrence, slice]);
      sections.push({ key: { kind: "slice", section: enclosing, slice, occurrence }, body: line });
    } else {
      const open = sections.at(-1);
      if (open === undefined) sections.push({ key: { kind: "preamble" }, body: line });
      else open.body += line;
    }
  }
  return sections.map(({ key, body }) => ({ key, alignmentId: JSON.stringify(key), body }));
}

function headingTextOf(line: string): string | undefined {
  const bare = withoutTerminator(line);
  const marker = MARKDOWN_HEADING.exec(bare);
  return marker === null ? undefined : bare.slice(marker[0].length).trim();
}

function withoutTerminator(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

type RemovedSegment = Extract<PlanDeltaSegment, { kind: "removed" }>;

function alignedSegments(
  baseSections: readonly PlanSection[],
  nextSections: readonly PlanSection[],
): PlanDeltaSegment[] {
  const baseIds = baseSections.map(({ alignmentId }) => alignmentId);
  const nextIds = nextSections.map(({ alignmentId }) => alignmentId);
  const keptInOrder = idsKeptInOrder(baseIds, nextIds);
  const pendingRemovals = baseSections.flatMap(({ key, alignmentId, body }, basePosition): RemovedSegment[] =>
    nextIds.includes(alignmentId) ? [] : [{ kind: "removed", key, base: body, basePosition }],
  );
  const segments: PlanDeltaSegment[] = [];
  nextSections.forEach((section, nextPosition) => {
    const basePosition = baseIds.indexOf(section.alignmentId);
    if (basePosition === -1) {
      segments.push({ kind: "added", key: section.key, next: section.body, nextPosition });
      return;
    }
    const moved = !keptInOrder.has(section.alignmentId);
    if (!moved) {
      const removedBefore = pendingRemovals.filter((removal) => removal.basePosition < basePosition);
      segments.push(...pendingRemovals.splice(0, removedBefore.length));
    }
    segments.push(alignedSegment(baseSections[basePosition]!, section, { basePosition, nextPosition, moved }));
  });
  return [...segments, ...pendingRemovals];
}

function idsKeptInOrder(baseIds: readonly string[], nextIds: readonly string[]): Set<string> {
  const sharedBase = baseIds.filter((id) => nextIds.includes(id));
  const sharedNext = nextIds.filter((id) => baseIds.includes(id));
  const kept = sequenceDiffOf(sharedBase, sharedNext).filter(({ change }) => change === "kept");
  return new Set(kept.map(({ line }) => line));
}

function alignedSegment(
  baseSection: PlanSection,
  nextSection: PlanSection,
  placement: Pick<AlignedFields, "basePosition" | "nextPosition" | "moved">,
): PlanDeltaSegment {
  const fields = { key: nextSection.key, base: baseSection.body, next: nextSection.body, ...placement };
  if (baseSection.body === nextSection.body) return { kind: "unchanged", ...fields };
  const onlyWhitespaceDiffers = collapsedWhitespace(baseSection.body) === collapsedWhitespace(nextSection.body);
  const kind = onlyWhitespaceDiffers ? "format-only" : "changed";
  return { kind, lines: sequenceDiffOf(linesOf(baseSection.body), linesOf(nextSection.body)), ...fields };
}

function collapsedWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function linesOf(body: string): string[] {
  return withoutTerminator(body).split("\n");
}

function sequenceDiffOf(base: readonly string[], next: readonly string[]): LineChange[] {
  const width = next.length + 1;
  const commonFrom = new Uint32Array((base.length + 1) * width);
  const common = (baseAt: number, nextAt: number): number => commonFrom[baseAt * width + nextAt] ?? 0;
  for (let baseAt = base.length - 1; baseAt >= 0; baseAt -= 1) {
    for (let nextAt = next.length - 1; nextAt >= 0; nextAt -= 1) {
      commonFrom[baseAt * width + nextAt] =
        base[baseAt] === next[nextAt]
          ? common(baseAt + 1, nextAt + 1) + 1
          : Math.max(common(baseAt + 1, nextAt), common(baseAt, nextAt + 1));
    }
  }
  const changes: LineChange[] = [];
  let baseAt = 0;
  let nextAt = 0;
  while (baseAt < base.length && nextAt < next.length) {
    if (base[baseAt] === next[nextAt]) {
      changes.push({ change: "kept", line: base[baseAt]! });
      baseAt += 1;
      nextAt += 1;
    } else if (common(baseAt + 1, nextAt) >= common(baseAt, nextAt + 1)) {
      changes.push({ change: "removed", line: base[baseAt]! });
      baseAt += 1;
    } else {
      changes.push({ change: "added", line: next[nextAt]! });
      nextAt += 1;
    }
  }
  return [
    ...changes,
    ...base.slice(baseAt).map((line): LineChange => ({ change: "removed", line })),
    ...next.slice(nextAt).map((line): LineChange => ({ change: "added", line })),
  ];
}

const AMENDMENT_OPENING = new RegExp(`^## (${EXECUTION_AMENDMENT_HEADING}|${PLAN_MODE_FEEDBACK_HEADING}) — (\\S+)$`);
const AMENDMENT_METADATA_THEN_TEXT = /^\n(?:- [^\n]*\n)+\n([\s\S]*)$/;

function amendmentsIn(current: string): DroppedAmendment[] {
  const opened: { heading: AmendmentHeading; sliceId: string; lines: string[] }[] = [];
  for (const line of current.split("\n")) {
    const opening = AMENDMENT_OPENING.exec(line);
    if (opening === null) opened.at(-1)?.lines.push(line);
    else opened.push({ heading: opening[1] as AmendmentHeading, sliceId: opening[2]!, lines: [] });
  }
  return opened.map(({ heading, sliceId, lines }) => {
    const metadataThenText = AMENDMENT_METADATA_THEN_TEXT.exec(lines.join("\n"));
    if (metadataThenText === null) {
      throw new PlanDeltaError(
        `current.md amendment "${heading} — ${sliceId}" carries no metadata block before its text`,
      );
    }
    return { heading, sliceId, text: metadataThenText[1]!.trimEnd() };
  });
}

const SEGMENT_KINDS = ["changed", "added", "removed", "format-only", "unchanged"] as const;

function segmentReport(segments: readonly PlanDeltaSegment[]): string[] {
  const differing = segments.filter((segment) => segment.kind !== "unchanged" || segment.moved);
  if (differing.length === 0) return [`No changes: the new plan matches the base in all ${segments.length} sections.`];
  const unchanged = segments.filter((segment) => segment.kind === "unchanged" && !segment.moved);
  const counts = SEGMENT_KINDS.map((kind) => `${segments.filter((segment) => segment.kind === kind).length} ${kind}`);
  return [
    `Plan delta: ${counts.join(", ")}, ${segments.filter(isMoved).length} moved.`,
    ...(unchanged.length === 0 ? [] : [`Unchanged: ${unchanged.map(({ key }) => labelOf(key)).join(", ")}.`]),
    ...differing.flatMap((segment) => [
      `${segment.kind} ${labelOf(segment.key)}${isMoved(segment) ? ", moved" : ""}`,
      ...signedLinesOf(segment).map((line) => `  ${line}`),
    ]),
  ];
}

function isMoved(segment: PlanDeltaSegment): boolean {
  return segment.kind !== "added" && segment.kind !== "removed" && segment.moved;
}

function labelOf(key: PlanSectionKey): string {
  if (key.kind === "preamble") return "preamble";
  if (key.kind === "slice") {
    return `${key.slice}${key.occurrence === 1 ? "" : ` #${key.occurrence}`} in ${labelOf(key.section)}`;
  }
  return key.occurrence === 1 ? `"${key.heading}"` : `"${key.heading}" #${key.occurrence}`;
}

function signedLinesOf(segment: PlanDeltaSegment): string[] {
  if (segment.kind === "added") return linesOf(segment.next).map((line) => `+ ${line}`);
  if (segment.kind === "removed") return linesOf(segment.base).map((line) => `- ${line}`);
  if (segment.kind === "unchanged") return [];
  return segment.lines.flatMap(({ change, line }) => {
    if (change === "kept") return [];
    return [`${change === "added" ? "+" : "-"} ${line}`];
  });
}

function droppedAmendmentReport(amendments: readonly DroppedAmendment[]): string[] {
  if (amendments.length === 0) return ["Dropped amendments: none."];
  return [
    `Dropped amendments: ${amendments.length}.`,
    ...amendments.flatMap(({ heading, sliceId, text }) => [
      `- ${heading} — ${sliceId}`,
      ...text.split("\n").map((line) => `  ${line}`),
    ]),
  ];
}
