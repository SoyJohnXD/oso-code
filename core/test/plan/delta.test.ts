import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  baseDocumentOf,
  nextDocumentOf,
  PlanDeltaError,
  planDeltaDigestOf,
  planDeltaOf,
  renderPlanDelta,
  type PlanDelta,
  type PlanSectionKey,
} from "../../src/plan/delta.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";

const REALISTIC_PLAN = readFileSync(
  path.join(repositoryRoot, "core", "test", "fixtures", "plan-documents", "every-slice-names-its-check.md"),
  "utf8",
);

function seededPick(seed: number): (bound: number) => number {
  let state = seed >>> 0;
  return (bound) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % bound;
  };
}

type LineEdit = (lines: string[], pick: (bound: number) => number) => void;

const LINE_EDITS: readonly LineEdit[] = [
  (lines, pick) => lines.splice(pick(lines.length + 1), 0, "- an inserted note"),
  (lines, pick) => lines.length > 1 && lines.splice(pick(lines.length), 1),
  (lines, pick) => {
    const at = pick(lines.length);
    lines[at] = `${lines[at]} (edited)`;
  },
  (lines, pick) => {
    const at = pick(lines.length);
    lines[at] = `${lines[at]?.replace(" ", "  ")}  `;
  },
  (lines, pick) => lines.splice(pick(lines.length), 0, ...lines.splice(pick(lines.length), 1)),
  (lines, pick) => lines.splice(pick(lines.length + 1), 0, "### Wave 1"),
  (lines) => lines.unshift("Draft written before the first heading."),
  (lines, pick) => {
    const [start, end] = sliceSpansOf(lines)[pick(3)] ?? [];
    if (start !== undefined && end !== undefined) lines[start + pick(end - start)] += " (edited in its slice)";
  },
  (lines, pick) => {
    const [start, end] = sliceSpansOf(lines)[pick(3)] ?? [];
    if (start !== undefined && end !== undefined) lines.splice(start, end - start);
  },
  (lines, pick) => {
    const spans = sliceSpansOf(lines);
    const adjacent = spans.flatMap((span, at) => (at > 0 && spans[at - 1]?.[1] === span[0] ? [at] : []));
    const at = adjacent[pick(adjacent.length)];
    if (at === undefined) return;
    const [start, end] = spans[at]!;
    lines.splice(spans[at - 1]![0], 0, ...lines.splice(start, end - start));
  },
];

const SLICE_OPENING_LINE = /^- \*\*S\d+ /;
const SLICE_BOUNDARY_LINE = /^(- \*\*S\d+ |#)/;

function sliceSpansOf(lines: readonly string[]): [number, number][] {
  return lines.flatMap((line, start) => {
    if (!SLICE_OPENING_LINE.test(line)) return [];
    let end = start + 1;
    while (end < lines.length && !SLICE_BOUNDARY_LINE.test(lines[end]!)) end += 1;
    return [[start, end] as [number, number]];
  });
}

function generatedEdit(seed: number): string {
  const pick = seededPick(seed);
  const lines = REALISTIC_PLAN.split("\n");
  const editCount = 1 + pick(4);
  for (let applied = 0; applied < editCount; applied += 1) LINE_EDITS[pick(LINE_EDITS.length)]?.(lines, pick);
  return lines.join("\n");
}

function swappedSections(document: string, first: string, second: string): string {
  const firstAt = document.indexOf(first);
  const secondAt = document.indexOf(second);
  const afterSecond = document.indexOf("\n## ", secondAt + 1) + 1;
  return (
    document.slice(0, firstAt) +
    document.slice(secondAt, afterSecond) +
    document.slice(firstAt, secondAt) +
    document.slice(afterSecond)
  );
}

const NAMED_EDITS: ReadonlyArray<readonly [string, string, string]> = [
  ["no heading anywhere", "just prose\nand more prose\n", "just prose\nand other prose\n"],
  ["no trailing newline", "# A\nx", "# A\nx\n"],
  ["a heading as the last line", "# A\nx\n## B", "# A\n## B\ny"],
  ["duplicate headings", "## N\na\n## N\nb\n", "## N\na\n## N\nb2\n## N\nc\n"],
  ["carriage returns kept as bytes", "# A\r\nx\r\n", "# A\r\nx\r\ny\r\n"],
  ["a preamble edit", REALISTIC_PLAN, `Draft note.\n${REALISTIC_PLAN}`],
  [
    "a section without slices",
    REALISTIC_PLAN,
    REALISTIC_PLAN.replace("## Verification bar\n\n", "## Verification bar\n\nAlso "),
  ],
  ["a reorder", REALISTIC_PLAN, swappedSections(REALISTIC_PLAN, "## Cómo va a funcionar", "## Planning disposition")],
  ["a slice edit", REALISTIC_PLAN, REALISTIC_PLAN.replace("Files: `CHANGELOG.md`.", "Files: `NEWS.md`.")],
  ["a heading that opens a slice", "### S3 — Title\nbody\n- S4 — x\ny", "### S3 — Renamed\nbody\n- S4 — x\ny\n"],
  ["duplicate slice labels", "## W\n- S1 — a\n- S1 — b\n", "## W\n- S1 — a\n- S1 — b2\n- S1 — c\n"],
];

function keyOf(key: PlanSectionKey): string {
  if (key.kind === "preamble") return "preamble";
  if (key.kind === "heading") return `${key.heading}#${key.occurrence}`;
  return `${keyOf(key.section)}/${key.slice}#${key.occurrence}`;
}

function kindsAndKeys(delta: PlanDelta): string[] {
  return delta.segments.map(
    (segment) => `${segment.kind} ${keyOf(segment.key)}${"moved" in segment && segment.moved ? " moved" : ""}`,
  );
}

function differingKindsAndKeys(base: string, next: string): string[] {
  return kindsAndKeys(planDeltaOf({ base, next })).filter((entry) => !entry.startsWith("unchanged "));
}

const WAVE = "## Notes\nfree\n## Wave\nlead\n- S1 — a\nbetween\n- S2 — b\nafter the last slice\n## Bar\nend\n";

describe("the plan delta partitions both documents totally", () => {
  for (const [name, base, next] of NAMED_EDITS) {
    test(`base and next are recovered byte for byte from the delta: ${name}`, () => {
      const delta = planDeltaOf({ base, next });
      assert.equal(baseDocumentOf(delta), base);
      assert.equal(nextDocumentOf(delta), next);
    });
  }

  test("two hundred seeded edits of a realistic plan reconstruct both documents", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const next = generatedEdit(seed);
      const delta = planDeltaOf({ base: REALISTIC_PLAN, next });
      assert.equal(baseDocumentOf(delta), REALISTIC_PLAN, `seed ${seed} lost the base`);
      assert.equal(nextDocumentOf(delta), next, `seed ${seed} lost the next document`);
    }
  });

  test("a swap of two sections is one move and nothing changed", () => {
    const next = swappedSections(REALISTIC_PLAN, "## Cómo va a funcionar", "## Planning disposition");
    assert.deepEqual(kindsAndKeys(planDeltaOf({ base: REALISTIC_PLAN, next })), [
      "unchanged Repaso de cambios#1",
      "unchanged Qué se va a realizar#1",
      "unchanged Decisiones del ledger que lo moldean#1",
      "unchanged Planning disposition#1",
      "unchanged Cómo va a funcionar#1 moved",
      "unchanged Slices#1",
      "unchanged Wave 1#1",
      "unchanged Wave 1#1/S1#1",
      "unchanged Wave 2 (width 2)#1",
      "unchanged Wave 2 (width 2)#1/S2#1",
      "unchanged Wave 2 (width 2)#1/S3#1",
      "unchanged Verification bar#1",
    ]);
  });

  test("each unit of a sliced section is its own segment", () => {
    assert.deepEqual(kindsAndKeys(planDeltaOf({ base: WAVE, next: WAVE })), [
      "unchanged Notes#1",
      "unchanged Wave#1",
      "unchanged Wave#1/S1#1",
      "unchanged Wave#1/S2#1",
      "unchanged Bar#1",
    ]);
  });

  const SLICE_BOUNDARY_CASES: ReadonlyArray<readonly [string, string, string, readonly string[]]> = [
    ["text in a section without slices", "free\n", "free text\n", ["changed Notes#1"]],
    ["text between a heading and its first slice", "lead\n", "lead text\n", ["changed Wave#1"]],
    ["text between two slices", "between\n", "between text\n", ["changed Wave#1/S1#1"]],
    ["text after the last slice", "after the last slice\n", "after it\n", ["changed Wave#1/S2#1"]],
    ["a deleted slice", "- S1 — a\nbetween\n", "", ["removed Wave#1/S1#1"]],
  ];
  for (const [name, original, replacement, expected] of SLICE_BOUNDARY_CASES) {
    test(`an edit to ${name} lands in its own segment`, () => {
      assert.deepEqual(differingKindsAndKeys(WAVE, WAVE.replace(original, replacement)), expected);
    });
  }

  test("a whitespace edit in one slice and a wording edit in its neighbour stay apart", () => {
    const next = REALISTIC_PLAN.replace("Goal: both host", "Goal:  both host").replace("changelog before", "notes before");
    assert.deepEqual(differingKindsAndKeys(REALISTIC_PLAN, next), [
      "format-only Wave 2 (width 2)#1/S2#1",
      "changed Wave 2 (width 2)#1/S3#1",
    ]);
  });

  test("a heading that opens a slice is keyed by the slice label and repeated labels count", () => {
    const slices = "body\n- S4 — x\n- S4 — y\n";
    const delta = planDeltaOf({ base: `### S3 — Title\n${slices}`, next: `### S3 — Renamed\n${slices}` });
    assert.deepEqual(kindsAndKeys(delta), [
      "changed S3#1",
      "unchanged S3#1/S4#1",
      "unchanged S3#1/S4#2",
    ]);
  });

  test("an edit to the second of two duplicate headings changes only that occurrence", () => {
    assert.deepEqual(kindsAndKeys(planDeltaOf({ base: "## N\na\n## N\nb\n", next: "## N\na\n## N\nb2\n" })), [
      "unchanged N#1",
      "changed N#2",
    ]);
  });
});

describe("format-only means equal after collapsing whitespace runs, and nothing else", () => {
  const CASES: ReadonlyArray<readonly [string, string, string, string]> = [
    ["whitespace runs", "Depends-on: S1, S2", "Depends-on:  S1,\tS2  ", "format-only"],
    ["a trailing newline", "Depends-on: S1", "Depends-on: S1\n\n", "format-only"],
    ["a negation", "- Do delete the cache.", "- Do not delete the cache.", "changed"],
    ["a path inside a code fence", "```\nnode core/src/a.ts\n```", "```\nnode core/src/b.ts\n```", "changed"],
    ["a reordered Depends-on", "Depends-on: S1, S2", "Depends-on: S2, S1", "changed"],
    ["whitespace removed between tokens", "Depends-on: S1, S2", "Depends-on: S1,S2", "changed"],
    ["a case change", "Verify: npm test", "verify: npm test", "changed"],
  ];
  for (const [name, baseBody, nextBody, expected] of CASES) {
    test(`${name} is ${expected}`, () => {
      const delta = planDeltaOf({ base: `## S\n${baseBody}`, next: `## S\n${nextBody}` });
      assert.deepEqual(kindsAndKeys(delta), [`${expected} S#1`]);
    });
  }

  test("a changed section carries its line diff with removals before additions", () => {
    const [segment] = planDeltaOf({ base: "## S\nkeep\nold\n", next: "## S\nkeep\nnew\n" }).segments;
    assert.ok(segment?.kind === "changed");
    assert.deepEqual(segment.lines, [
      { change: "kept", line: "## S" },
      { change: "kept", line: "keep" },
      { change: "removed", line: "old" },
      { change: "added", line: "new" },
    ]);
  });
});

const AMENDED_CURRENT =
  "# Plan\nbody\n\n\n## Execution amendment — S2\n\n- Added-at: 2026-01-01T00:00:00Z\n- Requested-by: operator\n" +
  "- Classification: in-scope\n\nAlso cover the empty case.\n\n\n## Plan Mode feedback — S1\n\n" +
  "- Added-at: 2026-01-02T00:00:00Z\n- Requested-by: operator\n- Classification: feedback\n\nRename the flag.\n";

describe("amendments in current.md the new document lacks verbatim are listed, never carried", () => {
  test("only the amendment missing from the new document is dropped", () => {
    const next = "# Plan\nbody\nAlso cover the empty case.\n";
    const delta = planDeltaOf({ base: "# Plan\nbody\n", next, current: AMENDED_CURRENT });
    assert.deepEqual(delta.droppedAmendments, [
      { heading: "Plan Mode feedback", sliceId: "S1", text: "Rename the flag." },
    ]);
  });

  test("a new document carrying both amendments drops none", () => {
    const next = "# Plan\nAlso cover the empty case.\nRename the flag.\n";
    assert.deepEqual(planDeltaOf({ base: "# Plan\nbody\n", next, current: AMENDED_CURRENT }).droppedAmendments, []);
  });

  test("an amendment rewritten with other whitespace counts as dropped", () => {
    const next = "# Plan\nAlso cover the  empty case.\nRename the flag.\n";
    const delta = planDeltaOf({ base: "# Plan\nbody\n", next, current: AMENDED_CURRENT });
    assert.deepEqual(delta.droppedAmendments, [
      { heading: "Execution amendment", sliceId: "S2", text: "Also cover the empty case." },
    ]);
  });

  test("no current text drops nothing", () => {
    assert.deepEqual(planDeltaOf({ base: "# Plan\nbody\n", next: "# Plan\n" }).droppedAmendments, []);
  });
});

const RENDER_BASE = "Draft intro\n# Plan\nkeep\n## Old\ngone\n## Edit\nalpha\n## Space\na b\n## Moved\nm\n";
const RENDER_NEXT = "Draft intro\n# Plan\nkeep\n## Moved\nm\n## Edit\nbeta\n## Space\na  b\n## New\nfresh\n";

describe("the rendering is stable English text and the digest binds it", () => {
  test("every kind renders with its key and line changes", () => {
    assert.equal(
      renderPlanDelta(planDeltaOf({ base: RENDER_BASE, next: RENDER_NEXT, current: AMENDED_CURRENT })),
      [
        "Plan delta: 1 changed, 1 added, 1 removed, 1 format-only, 3 unchanged, 1 moved.",
        'Unchanged: preamble, "Plan".',
        'unchanged "Moved", moved',
        'removed "Old"',
        "  - ## Old",
        "  - gone",
        'changed "Edit"',
        "  - alpha",
        "  + beta",
        'format-only "Space"',
        "  - a b",
        "  + a  b",
        'added "New"',
        "  + ## New",
        "  + fresh",
        "Dropped amendments: 2.",
        "- Execution amendment — S2",
        "  Also cover the empty case.",
        "- Plan Mode feedback — S1",
        "  Rename the flag.",
        "",
      ].join("\n"),
    );
  });

  test("an edit inside one slice renders as a change to that slice", () => {
    const next = REALISTIC_PLAN.replace("in the changelog before", "in the release notes before");
    assert.equal(
      renderPlanDelta(planDeltaOf({ base: REALISTIC_PLAN, next })),
      [
        "Plan delta: 1 changed, 0 added, 0 removed, 0 format-only, 11 unchanged, 0 moved.",
        'Unchanged: "Repaso de cambios", "Qué se va a realizar", "Decisiones del ledger que lo moldean", ' +
          '"Cómo va a funcionar", "Planning disposition", "Slices", "Wave 1", S1 in "Wave 1", ' +
          '"Wave 2 (width 2)", S2 in "Wave 2 (width 2)", "Verification bar".',
        'changed S3 in "Wave 2 (width 2)"',
        "  -   Goal: the change is readable in the changelog before anyone meets the refusal.",
        "  +   Goal: the change is readable in the release notes before anyone meets the refusal.",
        "Dropped amendments: none.",
        "",
      ].join("\n"),
    );
  });

  test("identical documents render one no-changes line", () => {
    assert.equal(
      renderPlanDelta(planDeltaOf({ base: "# A\nx\n## A\ny\n", next: "# A\nx\n## A\ny\n" })),
      'No changes: the new plan matches the base in all 2 sections.\nDropped amendments: none.\n',
    );
  });

  test("two runs are byte-identical and the digest is the sha256 of the rendering", () => {
    const first = planDeltaOf({ base: RENDER_BASE, next: RENDER_NEXT, current: AMENDED_CURRENT });
    const second = planDeltaOf({ base: RENDER_BASE, next: RENDER_NEXT, current: AMENDED_CURRENT });
    assert.deepEqual(first, second);
    assert.equal(renderPlanDelta(first), renderPlanDelta(second));
    assert.equal(planDeltaDigestOf(first), createHash("sha256").update(renderPlanDelta(first)).digest("hex"));
  });

  test("the digest moves exactly when the rendering moves", () => {
    const sameRenderingA = planDeltaOf({ base: "# A\nx\n", next: "# A\nx\n" });
    const sameRenderingB = planDeltaOf({ base: "# A\ny\n", next: "# A\ny\n" });
    const otherRendering = planDeltaOf({ base: "# A\nx\n", next: "# A\ny\n" });
    assert.equal(planDeltaDigestOf(sameRenderingA), planDeltaDigestOf(sameRenderingB));
    assert.notEqual(planDeltaDigestOf(sameRenderingA), planDeltaDigestOf(otherRendering));
  });
});

describe("input problems throw a specific error naming the cause", () => {
  const malformedCurrent = "# Plan\n\n## Execution amendment — S2\nno metadata block here\n";
  const CASES: ReadonlyArray<readonly [string, () => unknown, RegExp]> = [
    ["an empty base", () => planDeltaOf({ base: "", next: "# A\n" }), /non-empty base document/],
    ["an empty next", () => planDeltaOf({ base: "# A\n", next: "" }), /non-empty next document/],
    [
      "an amendment without its metadata block",
      () => planDeltaOf({ base: "# Plan\n", next: "# Plan\n", current: malformedCurrent }),
      /amendment "Execution amendment — S2" carries no metadata block/,
    ],
  ];
  for (const [name, attempt, cause] of CASES) {
    test(`${name} is refused`, () => {
      assert.throws(attempt, (error: unknown) => error instanceof PlanDeltaError && cause.test(error.message));
    });
  }
});
