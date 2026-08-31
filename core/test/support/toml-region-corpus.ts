import type { TomlRegionRequest } from "../../src/install/toml-regions.ts";

export const CONFIG_MARKER_START = "# oso-code:start";
export const CONFIG_MARKER_END = "# oso-code:end";
export const FEATURE_MARKER_START = "# oso-code:features:start";
export const FEATURE_MARKER_END = "# oso-code:features:end";
export const MODEL_KEY = "model_instructions_file";
export const COMPACT_KEY = "experimental_compact_prompt_file";
export const MODEL_VALUE = "/home/probe/.codex/engram-instructions.md";
export const COMPACT_VALUE = "/home/probe/.codex/engram-compact-prompt.md";
export const FEATURE_TEXT = "hooks = true\nmulti_agent = true\n";
export const REMOVE_TARGET_HEADER = "[mcp_servers.engram]";

export type CorpusDocument = Readonly<{ shape: string; text: string }>;
export type CorpusRequest = Readonly<{ named: string; request: TomlRegionRequest }>;

export const SHAPES_EXCLUDED_BY_CONSTRUCTION: readonly Readonly<{ named: string; because: string }>[] = [
  {
    named: "a document carrying an embedded NUL byte",
    because:
      "awk implementations disagree on whether a NUL ends the record, truncates it or passes through, so the oracle has no single answer to port against — and no TOML document holds one",
  },
  {
    named: "a document carrying a non-UTF-8 byte sequence",
    because:
      "awk splits records and matches [[:space:]] against the bytes its locale hands it, so the same file reads differently under C and under UTF-8; the port reads UTF-8 alone",
  },
  {
    named: "a document longer than a historical awk's record-length limit",
    because: "the installer renders every line it writes and none approaches it, so the limit measures the oracle rather than the region logic",
  },
];

const MANAGED_BODY = ['default_permissions = "oso"', "", "[agents]", "max_threads = 4"];

const REGION = [CONFIG_MARKER_START, ...MANAGED_BODY, CONFIG_MARKER_END];

const FEATURE_REGION = [FEATURE_MARKER_START, "hooks = true", "multi_agent = true", FEATURE_MARKER_END];

function document(shape: string, lines: readonly string[]): CorpusDocument {
  return { shape, text: lines.length === 0 ? "" : `${lines.join("\n")}\n` };
}

function withoutFinalNewline(shape: string, lines: readonly string[]): CorpusDocument {
  return { shape, text: lines.join("\n") };
}

function withCarriageReturns({ text }: CorpusDocument, named: string): CorpusDocument {
  return { shape: named, text: text.replaceAll("\n", "\r\n") };
}

const OPERATOR_PREAMBLE = ["# an operator comment nobody owns", 'model = "gpt-5"', "", "approval_policy = 'on-request'"];

const OPERATOR_TAIL = ["", "[history]", "persistence = \"save-all\"", "", "[mcp_servers.engram]", 'command = "engram"'];

const WITH_ONE_REGION = document("one managed region between operator text on both sides", [
  ...OPERATOR_PREAMBLE,
  "",
  ...REGION,
  ...OPERATOR_TAIL,
]);

export function corpusDocuments(): CorpusDocument[] {
  return [
    document("an empty file", []),
    document("a file holding one empty line", [""]),
    document("operator text with no managed region at all", [...OPERATOR_PREAMBLE, ...OPERATOR_TAIL]),
    WITH_ONE_REGION,
    document("a managed region alone, with nothing around it", REGION),
    document("a managed region opening the file, operator text after it", [...REGION, ...OPERATOR_TAIL]),
    document("a managed region closing the file, operator text before it", [...OPERATOR_PREAMBLE, ...REGION]),
    document("two managed regions, which every region action must refuse", [...OPERATOR_PREAMBLE, ...REGION, "", ...REGION]),
    document("a start marker with no end marker", [...OPERATOR_PREAMBLE, CONFIG_MARKER_START, ...MANAGED_BODY]),
    document("an end marker with no start marker", [...OPERATOR_PREAMBLE, ...MANAGED_BODY, CONFIG_MARKER_END]),
    document("a nested start marker inside an open region", [CONFIG_MARKER_START, CONFIG_MARKER_START, ...MANAGED_BODY, CONFIG_MARKER_END]),
    document("markers reversed, the end one first", [CONFIG_MARKER_END, ...MANAGED_BODY, CONFIG_MARKER_START]),
    document("a marker line inside a multiline basic string", [
      'notice = """',
      CONFIG_MARKER_START,
      "this is operator prose, not installer ownership",
      CONFIG_MARKER_END,
      '"""',
      ...OPERATOR_TAIL,
    ]),
    document("a marker line inside a multiline literal string", [
      "notice = '''",
      CONFIG_MARKER_START,
      "still operator prose",
      CONFIG_MARKER_END,
      "'''",
      ...OPERATOR_TAIL,
    ]),
    document("a multiline basic string closed by an escaped quote run, then a real marker", [
      'notice = """',
      CONFIG_MARKER_START,
      'an escaped \\""" does not close it',
      '"""',
      "",
      ...REGION,
    ]),
    document("a marker line inside a multi-line array", [
      "profiles = [",
      CONFIG_MARKER_START,
      '  "a",',
      CONFIG_MARKER_END,
      "]",
      ...OPERATOR_TAIL,
    ]),
    document("a marker line inside a multi-line inline table", [
      "server = {",
      CONFIG_MARKER_START,
      '  command = "x",',
      CONFIG_MARKER_END,
      "}",
      ...OPERATOR_TAIL,
    ]),
    document("a marker line inside an array nested in an inline table", [
      "server = { args = [",
      CONFIG_MARKER_START,
      '  "--flag",',
      "] }",
      ...REGION,
    ]),
    document("a bracket inside a single-quoted literal string, which opens no array", [
      "pattern = '['",
      ...REGION,
      ...OPERATOR_TAIL,
    ]),
    document("a bracket inside a basic string with an escaped quote before it", [
      'pattern = "say \\"[\\" once"',
      ...REGION,
    ]),
    document("a bracket inside a comment, which opens no array", ["# a [ left open in prose", ...REGION, ...OPERATOR_TAIL]),
    document("an unbalanced closing bracket at root, which never drives the depth below zero", ["]", "}", ...REGION]),
    document("a table header whose extra opening bracket leaves the depth open for every line after it", [
      "[a[",
      "b = 1",
      "[c]",
      ...REGION,
      ...OPERATOR_TAIL,
    ]),
    document("comments and unusual whitespace hugging the region", [
      "   # leading spaces before an operator comment",
      "\t",
      "",
      "",
      ...REGION,
      "\t   ",
      "   # trailing spaces after it",
      ...OPERATOR_TAIL,
    ]),
    document("a marker carrying trailing whitespace, which is a different line", [
      `${CONFIG_MARKER_START} `,
      ...MANAGED_BODY,
      `${CONFIG_MARKER_END}\t`,
      ...OPERATOR_TAIL,
    ]),
    document("a marker indented by one space, which is a different line", [
      ` ${CONFIG_MARKER_START}`,
      ...MANAGED_BODY,
      ` ${CONFIG_MARKER_END}`,
    ]),
    withoutFinalNewline("a region in a file whose last line carries no newline", [...OPERATOR_PREAMBLE, ...REGION, "[history]"]),
    withCarriageReturns(WITH_ONE_REGION, "a CRLF file carrying one managed region"),
    withCarriageReturns(document("a CRLF file with no managed region", [...OPERATOR_PREAMBLE, ...OPERATOR_TAIL]), "a CRLF file with no managed region"),
    document("a lone carriage return inside a line, which terminates no record", [`x = "a\rb"`, ...REGION]),
    document("a features table owning the managed feature region", [
      ...OPERATOR_PREAMBLE,
      "",
      "[features]",
      ...FEATURE_REGION,
      ...OPERATOR_TAIL,
    ]),
    document("a features table with operator keys beside the managed feature region", [
      "[features]",
      "operator_flag = true",
      ...FEATURE_REGION,
      "another_operator_flag = false",
    ]),
    document("a features table with no managed feature region", ["[features]", "operator_flag = true", ...OPERATOR_TAIL]),
    document("no features table at all", [...OPERATOR_PREAMBLE, ...OPERATOR_TAIL]),
    document("a features table carrying an oso-owned key outside the managed feature region", ["[features]", "hooks = true"]),
    document("a features table carrying a quoted oso-owned key outside the region", ["[features]", '"multi_agent" = true']),
    document("a root-level features key before any table, which conflicts with the managed table", ["features = { hooks = true }", ...OPERATOR_TAIL]),
    document("a dotted features table, which is a shape the managed table cannot own", ["[features.nested]", "flag = true"]),
    document("an array-of-tables spelling of features", ["[[features]]", "flag = true"]),
    document("a quoted features header, which the exact-header check does not own", ['["features"]', "flag = true"]),
    document("two features tables", ["[features]", "a = 1", "", "[features]", "b = 2"]),
    document("a features header carrying a trailing comment", ["[features] # operator note", ...FEATURE_REGION]),
    document("an unpaired feature start marker", ["[features]", FEATURE_MARKER_START, "hooks = true"]),
    document("a feature marker comment in a shape neither marker spells", ["[features]", "#oso-code:features:start", "hooks = true"]),
    document("engram pointers at root above a managed region", [
      `${MODEL_KEY} = "${MODEL_VALUE}"`,
      `${COMPACT_KEY} = "${COMPACT_VALUE}"`,
      "",
      ...REGION,
      ...OPERATOR_TAIL,
    ]),
    document("engram pointers at root below a managed region, which the normalizer moves", [
      ...OPERATOR_PREAMBLE,
      "",
      ...REGION,
      "",
      `${MODEL_KEY} = "${MODEL_VALUE}"`,
      `${COMPACT_KEY} = "${COMPACT_VALUE}"`,
      ...OPERATOR_TAIL,
    ]),
    document("engram pointers below a region with no empty separator line to consume", [
      ...REGION.slice(0, 1),
      ...MANAGED_BODY,
      CONFIG_MARKER_END,
      `${MODEL_KEY} = "${MODEL_VALUE}"`,
      `${COMPACT_KEY} = "${COMPACT_VALUE}"`,
    ]),
    document("engram pointers with no managed region at all", [
      ...OPERATOR_PREAMBLE,
      `${MODEL_KEY} = "${MODEL_VALUE}"`,
      `${COMPACT_KEY} = "${COMPACT_VALUE}"`,
    ]),
    document("an engram pointer whose value diverges from the expected path", [
      `${MODEL_KEY} = "/somewhere/else.md"`,
      `${COMPACT_KEY} = "${COMPACT_VALUE}"`,
      ...REGION,
    ]),
    document("an engram pointer spelled as a bare value rather than a quoted string", [
      `${MODEL_KEY} = ${MODEL_VALUE}`,
      `${COMPACT_KEY} = "${COMPACT_VALUE}"`,
      ...REGION,
    ]),
    document("a duplicated engram model pointer", [
      `${MODEL_KEY} = "${MODEL_VALUE}"`,
      `${MODEL_KEY} = "${MODEL_VALUE}"`,
      `${COMPACT_KEY} = "${COMPACT_VALUE}"`,
      ...REGION,
    ]),
    document("an engram pointer inside an array, which is no root pointer", [
      "rows = [",
      `${MODEL_KEY} = "${MODEL_VALUE}"`,
      "]",
      `${MODEL_KEY} = "${MODEL_VALUE}"`,
      `${COMPACT_KEY} = "${COMPACT_VALUE}"`,
      ...REGION,
    ]),
    document("the removable engram table between two operator tables", [
      "[history]",
      'persistence = "save-all"',
      REMOVE_TARGET_HEADER,
      'command = "engram"',
      'args = ["mcp"]',
      "[tui]",
      "theme = 'dark'",
    ]),
    document("the removable engram table closing the file", ["[history]", REMOVE_TARGET_HEADER, 'command = "engram"']),
    document("two removable engram tables, which the remover refuses", [
      REMOVE_TARGET_HEADER,
      'command = "engram"',
      REMOVE_TARGET_HEADER,
      'command = "engram"',
    ]),
    document("no removable engram table", [...OPERATOR_PREAMBLE]),
    document("a removable engram header inside a multiline string", ["notice = '''", REMOVE_TARGET_HEADER, "'''", "[history]"]),
  ];
}

export function corpusRequests(): CorpusRequest[] {
  return [
    { named: "strip", request: { action: "strip", startMarker: CONFIG_MARKER_START, endMarker: CONFIG_MARKER_END } },
    { named: "extract", request: { action: "extract", startMarker: CONFIG_MARKER_START, endMarker: CONFIG_MARKER_END } },
    {
      named: "extract under require_region",
      request: { action: "extract", startMarker: CONFIG_MARKER_START, endMarker: CONFIG_MARKER_END, requireRegion: true },
    },
    { named: "split", request: { action: "split" } },
    { named: "root-symbols", request: { action: "root-symbols" } },
    {
      named: "features-strip",
      request: { action: "features-strip", featureStartMarker: FEATURE_MARKER_START, featureEndMarker: FEATURE_MARKER_END },
    },
    { named: "features-merge", request: { action: "features-merge", featureText: FEATURE_TEXT } },
    {
      named: "engram-pointers",
      request: {
        action: "engram-pointers",
        startMarker: CONFIG_MARKER_START,
        endMarker: CONFIG_MARKER_END,
        modelKey: MODEL_KEY,
        compactKey: COMPACT_KEY,
        modelValue: MODEL_VALUE,
        compactValue: COMPACT_VALUE,
      },
    },
    {
      named: "engram-pointers under require_region",
      request: {
        action: "engram-pointers",
        startMarker: CONFIG_MARKER_START,
        endMarker: CONFIG_MARKER_END,
        modelKey: MODEL_KEY,
        compactKey: COMPACT_KEY,
        modelValue: MODEL_VALUE,
        compactValue: COMPACT_VALUE,
        requireRegion: true,
      },
    },
    { named: "remove-table", request: { action: "remove-table", targetHeader: REMOVE_TARGET_HEADER } },
  ];
}
