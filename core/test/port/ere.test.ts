import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ereMatches } from "../../src/shell/ere.ts";
import { provedSomething } from "../support/proved.ts";

type DialectCase = Readonly<{ pattern: string; command: string; bites: boolean }>;

type RejectedPattern = Readonly<{ rejected: string; neighbour: string; command: string }>;

type ClassRow = Readonly<{ pattern: string; denies: readonly string[] }>;

const POSIX_CLASSES: readonly DialectCase[] = [
  { pattern: "deploy-[[:alpha:]]+-now", command: "deploy-prod-now", bites: true },
  { pattern: "deploy-[[:alpha:]]+-now", command: "deploy-42-now", bites: false },
  { pattern: "release[[:digit:]]+", command: "release7", bites: true },
  { pattern: "release[[:digit:]]+", command: "releasex", bites: false },
  { pattern: "release-[[:alnum:]]+", command: "release-abc9", bites: true },
  { pattern: "release-[[:alnum:]]+", command: "release--", bites: false },
  { pattern: "ENV=[[:upper:]]+", command: "ENV=PROD npm start", bites: true },
  { pattern: "ENV=[[:upper:]]+", command: "ENV=prod npm start", bites: false },
  { pattern: "deploy --to=[[:lower:]]+", command: "deploy --to=prod", bites: true },
  { pattern: "deploy --to=[[:lower:]]+", command: "deploy --to=PROD", bites: false },
  { pattern: "^make[[:space:]]+release-prod", command: "make release-prod", bites: true },
  { pattern: "^make[[:space:]]+release-prod", command: "makerelease-prod", bites: false },
  { pattern: "helm[[:blank:]]+upgrade", command: "helm upgrade prod", bites: true },
  { pattern: "helm[[:blank:]]+upgrade", command: "helmupgrade prod", bites: false },
  { pattern: "deploy[[:punct:]]prod", command: "deploy:prod", bites: true },
  { pattern: "deploy[[:punct:]]prod", command: "deployXprod", bites: false },
  { pattern: "^ship[[:print:]]+$", command: "ship it now", bites: true },
  { pattern: "^ship[[:print:]]+$", command: "ship\tit now", bites: false },
  { pattern: "push[[:graph:]]+prod", command: "push--prod", bites: true },
  { pattern: "push[[:graph:]]+prod", command: "push  prod", bites: false },
  { pattern: "deploy[[:cntrl:]]prod", command: "deploy\tprod", bites: true },
  { pattern: "deploy[[:cntrl:]]prod", command: "deploy prod", bites: false },
  { pattern: "image:[[:xdigit:]]+", command: "image:beef", bites: true },
  { pattern: "image:[[:xdigit:]]+", command: "image:zzz", bites: false },
  { pattern: "[^[:digit:]]-prod", command: "x-prod", bites: true },
  { pattern: "[^[:digit:]]-prod", command: "7-prod", bites: false },
  { pattern: "[[:alpha:][:digit:]]-prod", command: "7-prod", bites: true },
  { pattern: "[[:alpha:]0-9]-prod", command: "9-prod", bites: true },
];

const ESCAPES_ERE_READS_AS_LITERALS: readonly DialectCase[] = [
  { pattern: "scale --replicas=\\d", command: "kubectl scale --replicas=d", bites: true },
  { pattern: "scale --replicas=\\d", command: "kubectl scale --replicas=3", bites: false },
  { pattern: "\\D-prod", command: "D-prod", bites: true },
  { pattern: "\\D-prod", command: "5-prod", bites: false },
  { pattern: "ship\\now", command: "shipnow", bites: true },
  { pattern: "ship\\tnow", command: "shiptnow", bites: true },
  { pattern: "ship\\anow", command: "shipanow", bites: true },
  { pattern: "ship\\x41now", command: "shipx41now", bites: true },
  { pattern: "deploy\\.prod", command: "deploy.prod", bites: true },
  { pattern: "deploy\\.prod", command: "deployXprod", bites: false },
  { pattern: "deploy\\{2\\}", command: "deploy{2}", bites: true },
  { pattern: "deploy\\|ship", command: "deploy|ship", bites: true },
];

const GNU_ESCAPE_EXTENSIONS: readonly DialectCase[] = [
  { pattern: "\\wdeploy", command: "1deploy", bites: true },
  { pattern: "\\wdeploy", command: "-deploy", bites: false },
  { pattern: "\\Wdeploy", command: "-deploy", bites: true },
  { pattern: "\\sprod", command: " prod", bites: true },
  { pattern: "\\sprod", command: "xprod", bites: false },
  { pattern: "\\Sprod", command: "xprod", bites: true },
  { pattern: "\\bprod\\b", command: "run prod now", bites: true },
  { pattern: "\\bprod\\b", command: "runprodnow", bites: false },
  { pattern: "\\Bprod", command: "runprod", bites: true },
  { pattern: "\\<prod", command: "run prod", bites: true },
  { pattern: "\\<prod", command: "runprod", bites: false },
  { pattern: "prod\\>", command: "run prod", bites: true },
  { pattern: "prod\\>", command: "prodly", bites: false },
  { pattern: "\\`ship", command: "ship it", bites: true },
  { pattern: "\\`ship", command: "now ship it", bites: false },
  { pattern: "prod\\'", command: "run prod", bites: true },
  { pattern: "prod\\'", command: "run prod now", bites: false },
  { pattern: "(deploy)-\\1", command: "deploy-deploy", bites: true },
  { pattern: "(deploy)-\\1", command: "deploy-ship", bites: false },
];

const BRACKET_RULES: readonly DialectCase[] = [
  { pattern: "deploy[]x]prod", command: "deploy]prod", bites: true },
  { pattern: "deploy[]x]prod", command: "deployxprod", bites: true },
  { pattern: "deploy[^]x]prod", command: "deploy-prod", bites: true },
  { pattern: "deploy[^]x]prod", command: "deploy]prod", bites: false },
  { pattern: "deploy[a-]prod", command: "deploy-prod", bites: true },
  { pattern: "deploy[-a]prod", command: "deploy-prod", bites: true },
  { pattern: "deploy[\\]]prod", command: "deploy\\]prod", bites: true },
  { pattern: "deploy[\\]]prod", command: "deploy]prod", bites: false },
  { pattern: "deploy[\\t]prod", command: "deploytprod", bites: true },
  { pattern: "deploy[\\t]prod", command: "deploy\tprod", bites: false },
  { pattern: "deploy[a^]prod", command: "deploy^prod", bites: true },
];

const INTERVAL_RULES: readonly DialectCase[] = [
  { pattern: "^a{2}$", command: "aa", bites: true },
  { pattern: "^a{2}$", command: "aaa", bites: false },
  { pattern: "^a{2,}$", command: "aaa", bites: true },
  { pattern: "^a{,2}$", command: "aa", bites: true },
  { pattern: "^a{,2}$", command: "aaa", bites: false },
  { pattern: "^a{,}$", command: "aaa", bites: true },
  { pattern: "^a{1,2}{2}$", command: "aaa", bites: true },
  { pattern: "^a{1,2}{2}$", command: "a", bites: false },
  { pattern: "deploy{prod}", command: "deploy{prod}", bites: true },
  { pattern: "deploy{", command: "deploy{", bites: true },
];

const LINE_SCOPED_READING: readonly DialectCase[] = [
  { pattern: "deploy.prod", command: "deploy\nprod", bites: false },
  { pattern: "deploy[^x]prod", command: "deploy\nprod", bites: false },
  { pattern: "^prod$", command: "deploy\nprod", bites: true },
  { pattern: "^prod$", command: "deploy\nprod\n", bites: true },
  { pattern: "^$", command: "deploy\n", bites: false },
  { pattern: "^$", command: "deploy\n\n", bites: true },
  { pattern: "deploy.prod", command: "deploy\rprod", bites: true },
  { pattern: "a*", command: "", bites: false },
];

const PCRE_LOOKALIKES_GREP_READS_AS_ERE: readonly DialectCase[] = [
  { pattern: "(?:deploy|ship)-prod", command: "ship-prod", bites: true },
  { pattern: "(?:deploy|ship)-prod", command: ":deploy-prod", bites: true },
  { pattern: "(?:deploy|ship)-prod", command: "deploy-prod", bites: false },
  { pattern: "(?=prod)", command: "prod", bites: false },
  { pattern: "(?=prod)", command: "npm run build", bites: false },
  { pattern: "[[=a=]]-prod", command: "a-prod", bites: true },
  { pattern: "[[=a=]]-prod", command: "b-prod", bites: false },
  { pattern: "[[.a.]]-prod", command: "a-prod", bites: true },
  { pattern: "[[.a.]]-prod", command: "b-prod", bites: false },
  { pattern: "*deploy-prod", command: "npm run deploy-prod", bites: true },
  { pattern: "*deploy-prod", command: "npm run build", bites: false },
  { pattern: "{2}deploy", command: "npm run deploy-prod", bites: true },
  { pattern: "{2}deploy", command: "npm run build", bites: false },
];

const A_LEADING_BRACE_ELSEWHERE: readonly DialectCase[] = [
  { pattern: "{y$", command: "{y", bites: true },
  { pattern: "{y$", command: "y", bites: false },
  { pattern: "{a{1,3}$", command: "x{a", bites: true },
  { pattern: "{a{1,3}$", command: "{ab", bites: false },
  { pattern: "{b$", command: "{ab", bites: false },
  { pattern: "{[[:alnum:]]b$", command: "{ab", bites: true },
];

const PATTERNS_GREP_REJECTS: readonly RejectedPattern[] = [
  { rejected: "[abc-prod", neighbour: "[abc]-prod", command: "a-prod" },
  { rejected: "(deploy-prod", neighbour: "(deploy)-prod", command: "deploy-prod" },
  { rejected: "[z-a]-prod", neighbour: "[a-z]-prod", command: "a-prod" },
  { rejected: "deploy-prod\\", neighbour: "deploy-prod", command: "deploy-prod" },
  { rejected: "[[:word:]]-prod", neighbour: "[[:alpha:]]-prod", command: "a-prod" },
  { rejected: "deploy(", neighbour: "deploy\\(", command: "deploy(" },
  { rejected: "deploy[", neighbour: "deploy\\[", command: "deploy[" },
  { rejected: "a{2,1}", neighbour: "a{1,2}", command: "aa" },
  { rejected: "[[:bogus:]]x", neighbour: "[[:alpha:]]x", command: "ax" },
  { rejected: "((deploy)", neighbour: "((deploy))", command: "deploy" },
];

const ZERO_WIDTH_CLASS_COMMANDS: readonly string[] = ["x{2}y", "a{2}", "ab", "a b", "{2}"];

const AN_INTERVAL_AFTER_A_ZERO_WIDTH_CONSTRUCT: readonly ClassRow[] = [
  { pattern: "\\b{2}$", denies: ["a{2}", "{2}"] },
  { pattern: "\\b{3}$", denies: [] },
  { pattern: "\\b{1,2}$", denies: [] },
  { pattern: "\\b{0}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\b{,2}$", denies: [] },
  { pattern: "\\b{2,}$", denies: [] },
  { pattern: "\\B{2}$", denies: [] },
  { pattern: "\\B{3}$", denies: [] },
  { pattern: "\\B{1,2}$", denies: [] },
  { pattern: "\\B{0}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\B{,2}$", denies: [] },
  { pattern: "\\B{2,}$", denies: [] },
  { pattern: "\\<{2}$", denies: ["a{2}", "{2}"] },
  { pattern: "\\<{3}$", denies: [] },
  { pattern: "\\<{1,2}$", denies: [] },
  { pattern: "\\<{0}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\<{,2}$", denies: [] },
  { pattern: "\\<{2,}$", denies: [] },
  { pattern: "\\>{2}$", denies: [] },
  { pattern: "\\>{3}$", denies: [] },
  { pattern: "\\>{1,2}$", denies: [] },
  { pattern: "\\>{0}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\>{,2}$", denies: [] },
  { pattern: "\\>{2,}$", denies: [] },
  { pattern: "\\`{2}$", denies: [] },
  { pattern: "\\`{3}$", denies: [] },
  { pattern: "\\`{1,2}$", denies: [] },
  { pattern: "\\`{0}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\`{,2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\`{2,}$", denies: [] },
  { pattern: "\\'{2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\'{3}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\'{1,2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\'{0}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\'{,2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\'{2,}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "^{2}$", denies: [] },
  { pattern: "^{3}$", denies: [] },
  { pattern: "^{1,2}$", denies: [] },
  { pattern: "^{0}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "^{,2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "^{2,}$", denies: [] },
  { pattern: "${2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "${3}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "${1,2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "${0}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "${,2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "${2,}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
];

const A_LEADING_BRACE_BEFORE_A_POSIX_CLASS: readonly DialectCase[] = [
  { pattern: "{[[:alnum:]]$", command: "q{zzzz", bites: false },
  { pattern: "{[[:alnum:]]$", command: "{ab", bites: false },
  { pattern: "{[[:alnum:]]{1,3}$", command: "x{2}y", bites: false },
  { pattern: "{[[:alpha:]]$", command: "{abc", bites: false },
];

const ERE_DIALECT: Readonly<Record<string, readonly DialectCase[]>> = {
  "a POSIX character class is one class name, never a bracket holding colons and letters": POSIX_CLASSES,
  "a backslash escape ERE never defined is the letter itself, so \\\\d matches a literal d": ESCAPES_ERE_READS_AS_LITERALS,
  "the escapes GNU grep does define read words, spaces, buffers and earlier groups": GNU_ESCAPE_EXTENSIONS,
  "a bracket expression reads ], - and \\\\ by POSIX rules rather than by JavaScript's": BRACKET_RULES,
  "an interval is {n}, {n,}, {,m} or {n,m}, and every other brace is a literal brace": INTERVAL_RULES,
  "grep reads one line at a time, so no anchor, dot or negated class crosses a newline": LINE_SCOPED_READING,
  "a PCRE spelling grep accepts is read as the ERE grep reads it, never refused": PCRE_LOOKALIKES_GREP_READS_AS_ERE,
  "a leading brace that begins no interval is the literal brace grep matches": A_LEADING_BRACE_ELSEWHERE,
};

const dialectCaseCount = Object.values(ERE_DIALECT).reduce((total, cases) => total + cases.length, 0);
const dialectBites = Object.values(ERE_DIALECT).reduce(
  (total, cases) => total + cases.filter((one) => one.bites).length,
  0,
);
const classCaseCount = AN_INTERVAL_AFTER_A_ZERO_WIDTH_CONSTRUCT.length * ZERO_WIDTH_CLASS_COMMANDS.length;
const classBites = AN_INTERVAL_AFTER_A_ZERO_WIDTH_CONSTRUCT.reduce((total, row) => total + row.denies.length, 0);

provedSomething(
  `${dialectCaseCount} dialect readings, ${classCaseCount} interval-after-a-zero-width readings and ` +
    `${PATTERNS_GREP_REJECTS.length} rejected patterns are exercised, ${dialectBites + classBites} of which bite`,
  dialectBites > 0 && classBites > 0 && PATTERNS_GREP_REJECTS.length > 0,
  "the ERE suite carries no case that bites, so a reader matching nothing at all would pass it clean",
);

for (const [rule, cases] of Object.entries(ERE_DIALECT)) {
  describe(`core/src/shell/ere.ts: ${rule} (read from plugin/hooks/block-prod-deploy.sh:130)`, () => {
    for (const { pattern, command, bites } of cases) {
      test(`${JSON.stringify(pattern)} ${bites ? "bites" : "spares"} ${JSON.stringify(command)}`, () => {
        assert.equal(ereMatches(pattern, command), bites);
      });
    }
  });
}

describe(
  "core/src/shell/ere.ts: an interval after a zero-width construct is the literal braces GNU demotes it to " +
    "(read from plugin/hooks/block-prod-deploy.sh:130)",
  () => {
    for (const { pattern, denies } of AN_INTERVAL_AFTER_A_ZERO_WIDTH_CONSTRUCT) {
      for (const command of ZERO_WIDTH_CLASS_COMMANDS) {
        const bites = denies.includes(command);
        test(`${JSON.stringify(pattern)} ${bites ? "bites" : "spares"} ${JSON.stringify(command)}`, () => {
          assert.equal(ereMatches(pattern, command), bites);
        });
      }
    }
  },
);

describe(
  "core/src/shell/ere.ts: a pattern grep exits 2 on matches nothing, exactly as the bash gate's own grep " +
    "does (read from plugin/hooks/block-prod-deploy.sh:130,134)",
  () => {
    for (const { rejected, neighbour, command } of PATTERNS_GREP_REJECTS) {
      test(`${JSON.stringify(rejected)} spares ${JSON.stringify(command)}`, () => {
        assert.equal(ereMatches(rejected, command), false);
      });

      test(`${JSON.stringify(neighbour)}, which grep accepts, still bites ${JSON.stringify(command)}`, () => {
        assert.equal(ereMatches(neighbour, command), true);
      });
    }
  },
);

describe(
  "core/src/shell/ere.ts: PINNED HOLE — GNU 3.12 reads a leading brace before a POSIX-class bracket two " +
    "mutually exclusive ways, so the reader takes the literal one it takes everywhere else",
  () => {
    for (const { pattern, command, bites } of A_LEADING_BRACE_BEFORE_A_POSIX_CLASS) {
      test(`${JSON.stringify(pattern)} spares ${JSON.stringify(command)}, which /usr/bin/grep 3.12 bites`, () => {
        assert.equal(ereMatches(pattern, command), bites);
      });
    }
  },
);
