import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ereReads, type ErePatternReading } from "../../src/shell/ere.ts";
import { provedSomething } from "../support/proved.ts";

type DialectCase = Readonly<{ pattern: string; command: string; bites: boolean }>;

type RejectedPattern = Readonly<{ rejected: string; neighbour: string; command: string }>;

type ClassRow = Readonly<{ pattern: string; denies: readonly string[] }>;

type UntranslatablePattern = Readonly<{ pattern: string; command: string }>;

const BITES: ErePatternReading = "matched";
const SPARES: ErePatternReading = "unmatched";
const UNTRANSLATABLE: ErePatternReading = "untranslatable";

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

const A_LEADING_CLOSING_BRACKET: readonly DialectCase[] = [
  { pattern: "deploy[]]prod", command: "deploy]prod", bites: true },
  { pattern: "deploy[]]prod", command: "deployaprod", bites: false },
  { pattern: "deploy[]-]prod", command: "deploy]prod", bites: true },
  { pattern: "deploy[]-]prod", command: "deploy-prod", bites: true },
  { pattern: "deploy[]-]prod", command: "deployaprod", bites: false },
  { pattern: "deploy[]a]prod", command: "deploy]prod", bites: true },
  { pattern: "deploy[]a]prod", command: "deployaprod", bites: true },
  { pattern: "deploy[]a]prod", command: "deploy-prod", bites: false },
  { pattern: "deploy[]-a]prod", command: "deploy]prod", bites: true },
  { pattern: "deploy[]-a]prod", command: "deploy^prod", bites: true },
  { pattern: "deploy[]-a]prod", command: "deploy_prod", bites: true },
  { pattern: "deploy[]-a]prod", command: "deployaprod", bites: true },
  { pattern: "deploy[]-a]prod", command: "deploy-prod", bites: false },
  { pattern: "deploy[]-a]prod", command: "deploybprod", bites: false },
  { pattern: "deploy[]a-c]prod", command: "deploy]prod", bites: true },
  { pattern: "deploy[]a-c]prod", command: "deploybprod", bites: true },
  { pattern: "deploy[]a-c]prod", command: "deploy-prod", bites: false },
  { pattern: "deploy[]a-c]prod", command: "deploy^prod", bites: false },
  { pattern: "deploy[^]-a]prod", command: "deploy-prod", bites: true },
  { pattern: "deploy[^]-a]prod", command: "deploy]prod", bites: false },
  { pattern: "deploy[^]-a]prod", command: "deploy^prod", bites: false },
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

const A_RANGE_CROSSING_THE_ASCII_BLOCKS: readonly DialectCase[] = [
  { pattern: "[!-~]+ --prod", command: "shipit --prod", bites: true },
  { pattern: "[!-~]+ --prod", command: "  --prod", bites: false },
  { pattern: "[A-z]+ --prod", command: "shipit --prod", bites: true },
  { pattern: "[A-z]+ --prod", command: "!!! --prod", bites: false },
  { pattern: "ship[ -/]*it", command: "ship-it now", bites: true },
  { pattern: "ship[ -/]*it", command: "shipXit", bites: false },
  { pattern: "[0-A]x", command: "9x", bites: true },
  { pattern: "[0-A]x", command: "Bx", bites: false },
  { pattern: "[:-@]prod", command: "=prod", bites: true },
  { pattern: "[:-@]prod", command: "aprod", bites: false },
  { pattern: "[a-a]prod", command: "aprod", bites: true },
  { pattern: "[a-a]prod", command: "bprod", bites: false },
  { pattern: "[Z-a]prod", command: "^prod", bites: true },
  { pattern: "[Z-a]prod", command: "bprod", bites: false },
  { pattern: "[^ -~]deploy", command: "\tdeploy", bites: true },
  { pattern: "[^ -~]deploy", command: "xdeploy", bites: false },
  { pattern: "[[:digit:]!-/]x", command: "-x", bites: true },
  { pattern: "[[:digit:]!-/]x", command: "zx", bites: false },
];

const A_QUANTIFIED_ZERO_WIDTH_ESCAPE_BEFORE_A_WORD: readonly DialectCase[] = [
  { pattern: "\\bdeploy", command: "predeploy", bites: false },
  { pattern: "\\b?deploy", command: "predeploy", bites: true },
  { pattern: "\\b*deploy", command: "predeploy", bites: true },
  { pattern: "\\b+deploy", command: "predeploy", bites: false },
  { pattern: "\\<deploy", command: "predeploy", bites: false },
  { pattern: "\\<?deploy", command: "predeploy", bites: true },
  { pattern: "\\<*deploy", command: "predeploy", bites: true },
  { pattern: "\\<+deploy", command: "predeploy", bites: false },
  { pattern: "\\b", command: "{}", bites: false },
  { pattern: "\\b?", command: "{}", bites: true },
  { pattern: "\\>", command: "  ", bites: false },
  { pattern: "\\>*", command: "  ", bites: true },
  { pattern: "prod\\>ly", command: "prodly", bites: false },
  { pattern: "prod\\>?ly", command: "prodly", bites: true },
];

const PATTERNS_GREP_REJECTS: readonly RejectedPattern[] = [
  { rejected: "[abc-prod", neighbour: "[abc]-prod", command: "a-prod" },
  { rejected: "(deploy-prod", neighbour: "(deploy)-prod", command: "deploy-prod" },
  { rejected: "[z-a]-prod", neighbour: "[a-z]-prod", command: "a-prod" },
  { rejected: "[]-!]x", neighbour: "[]-a]x", command: "^x" },
  { rejected: "deploy-prod\\", neighbour: "deploy-prod", command: "deploy-prod" },
  { rejected: "[[:word:]]-prod", neighbour: "[[:alpha:]]-prod", command: "a-prod" },
  { rejected: "deploy(", neighbour: "deploy\\(", command: "deploy(" },
  { rejected: "deploy[", neighbour: "deploy\\[", command: "deploy[" },
  { rejected: "a{2,1}", neighbour: "a{1,2}", command: "aa" },
  { rejected: "[[:bogus:]]x", neighbour: "[[:alpha:]]x", command: "ax" },
  { rejected: "((deploy)", neighbour: "((deploy))", command: "deploy" },
];

const ZERO_WIDTH_CLASS_COMMANDS: readonly string[] = ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "];

const A_QUANTIFIER_ON_A_ZERO_WIDTH_CONSTRUCT: readonly ClassRow[] = [
  { pattern: "\\b?$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\b*$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\b+$", denies: ["x{2}y", "ab", "a b"] },
  { pattern: "\\b{2}$", denies: ["x{2}y", "ab", "a b"] },
  { pattern: "\\b{3}$", denies: ["x{2}y", "ab", "a b"] },
  { pattern: "\\b{1,2}$", denies: ["x{2}y", "ab", "a b"] },
  { pattern: "\\b{0}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\b{,2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\b{2,}$", denies: ["x{2}y", "ab", "a b"] },
  { pattern: "\\B?$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\B*$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\B+$", denies: ["a{2}", "{2}", "{}", "  "] },
  { pattern: "\\B{2}$", denies: ["a{2}", "{2}", "{}", "  "] },
  { pattern: "\\B{3}$", denies: ["a{2}", "{2}", "{}", "  "] },
  { pattern: "\\B{1,2}$", denies: ["a{2}", "{2}", "{}", "  "] },
  { pattern: "\\B{0}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\B{,2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\B{2,}$", denies: ["a{2}", "{2}", "{}", "  "] },
  { pattern: "\\<?$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\<*$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\<+$", denies: [] },
  { pattern: "\\<{2}$", denies: [] },
  { pattern: "\\<{3}$", denies: [] },
  { pattern: "\\<{1,2}$", denies: [] },
  { pattern: "\\<{0}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\<{,2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\<{2,}$", denies: [] },
  { pattern: "\\>?$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\>*$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\>+$", denies: ["x{2}y", "ab", "a b"] },
  { pattern: "\\>{2}$", denies: ["x{2}y", "ab", "a b"] },
  { pattern: "\\>{3}$", denies: ["x{2}y", "ab", "a b"] },
  { pattern: "\\>{1,2}$", denies: ["x{2}y", "ab", "a b"] },
  { pattern: "\\>{0}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\>{,2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\>{2,}$", denies: ["x{2}y", "ab", "a b"] },
  { pattern: "\\`?$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\`*$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\`+$", denies: [] },
  { pattern: "\\`{2}$", denies: [] },
  { pattern: "\\`{3}$", denies: [] },
  { pattern: "\\`{1,2}$", denies: [] },
  { pattern: "\\`{0}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\`{,2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\`{2,}$", denies: [] },
  { pattern: "\\'?$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\'*$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\'+$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\'{2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\'{3}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\'{1,2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\'{0}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\'{,2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\'{2,}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "^?$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "^*$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "^+$", denies: [] },
  { pattern: "^{2}$", denies: [] },
  { pattern: "^{3}$", denies: [] },
  { pattern: "^{1,2}$", denies: [] },
  { pattern: "^{0}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "^{,2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "^{2,}$", denies: [] },
  { pattern: "$?$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "$*$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "$+$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "${2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "${3}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "${1,2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "${0}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "${,2}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "${2,}$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\b", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\b?", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\b*", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\b+", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\B", denies: ["a{2}", "ab", "{2}", "{}", "  "] },
  { pattern: "\\B?", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\B*", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\B+", denies: ["a{2}", "ab", "{2}", "{}", "  "] },
  { pattern: "\\<", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\<?", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\<*", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\<+", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\>", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\>?", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\>*", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\>+", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}"] },
  { pattern: "\\`", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\`?", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\`*", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\`+", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\'", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\'?", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\'*", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "\\'+", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "^", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "^?", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "^*", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "^+", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "$", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "$?", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "$*", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
  { pattern: "$+", denies: ["x{2}y", "a{2}", "ab", "a b", "{2}", "{}", "  "] },
];

const PATTERNS_THE_READER_CANNOT_TRANSLATE: readonly UntranslatablePattern[] = [
  { pattern: "[a-\u00e9]-prod", command: "a-prod" },
  { pattern: "[^a-\u00e9]-prod", command: "0-prod" },
  { pattern: "[\u00e9-\u00fc]x", command: "x" },
  { pattern: "[[=+=]]x", command: "+x" },
  { pattern: "[[.a.]-z]x", command: "mx" },
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
  "a ] opening a bracket is its first member, so a - right after it opens a range from ] rather than a literal dash":
    A_LEADING_CLOSING_BRACKET,
  "an interval is {n}, {n,}, {,m} or {n,m}, and every other brace is a literal brace": INTERVAL_RULES,
  "grep reads one line at a time, so no anchor, dot or negated class crosses a newline": LINE_SCOPED_READING,
  "a PCRE spelling grep accepts is read as the ERE grep reads it, never refused": PCRE_LOOKALIKES_GREP_READS_AS_ERE,
  "a leading brace that begins no interval is the literal brace grep matches": A_LEADING_BRACE_ELSEWHERE,
  "a bracket range reads by code point under LC_ALL=C, so its endpoints need not share an ASCII block":
    A_RANGE_CROSSING_THE_ASCII_BLOCKS,
  "zero repetitions satisfy ? and * on a word-edge escape, while + keeps the assertion mandatory":
    A_QUANTIFIED_ZERO_WIDTH_ESCAPE_BEFORE_A_WORD,
};

const dialectCaseCount = Object.values(ERE_DIALECT).reduce((total, cases) => total + cases.length, 0);
const dialectBites = Object.values(ERE_DIALECT).reduce(
  (total, cases) => total + cases.filter((one) => one.bites).length,
  0,
);
const classCaseCount = A_QUANTIFIER_ON_A_ZERO_WIDTH_CONSTRUCT.length * ZERO_WIDTH_CLASS_COMMANDS.length;
const classBites = A_QUANTIFIER_ON_A_ZERO_WIDTH_CONSTRUCT.reduce((total, row) => total + row.denies.length, 0);

provedSomething(
  `${dialectCaseCount} dialect readings, ${classCaseCount} quantified-zero-width readings, ` +
    `${PATTERNS_GREP_REJECTS.length} rejected patterns and ${PATTERNS_THE_READER_CANNOT_TRANSLATE.length} ` +
    `untranslatable patterns are exercised, ${dialectBites + classBites} of which bite`,
  dialectBites > 0 && classBites > 0 && PATTERNS_GREP_REJECTS.length > 0 &&
    PATTERNS_THE_READER_CANNOT_TRANSLATE.length > 0,
  "the ERE suite carries no case that bites, so a reader matching nothing at all would pass it clean",
);

for (const [rule, cases] of Object.entries(ERE_DIALECT)) {
  describe(`core/src/shell/ere.ts: ${rule} (read from plugin/hooks/block-prod-deploy.sh:130)`, () => {
    for (const { pattern, command, bites } of cases) {
      test(`${JSON.stringify(pattern)} ${bites ? "bites" : "spares"} ${JSON.stringify(command)}`, () => {
        assert.equal(ereReads(pattern, command), bites ? BITES : SPARES);
      });
    }
  });
}

describe(
  "core/src/shell/ere.ts: a quantifier on a zero-width construct binds to the assertion itself, so ?, *, {0} " +
    "and {,m} let zero repetitions satisfy it while + and a low-bounded interval keep it mandatory — every row " +
    "below re-derived from /usr/bin/grep -E 3.12 under LC_ALL=C rather than from the reader it checks " +
    "(read from plugin/hooks/block-prod-deploy.sh:130)",
  () => {
    for (const { pattern, denies } of A_QUANTIFIER_ON_A_ZERO_WIDTH_CONSTRUCT) {
      for (const command of ZERO_WIDTH_CLASS_COMMANDS) {
        const bites = denies.includes(command);
        test(`${JSON.stringify(pattern)} ${bites ? "bites" : "spares"} ${JSON.stringify(command)}`, () => {
          assert.equal(ereReads(pattern, command), bites ? BITES : SPARES);
        });
      }
    }
  },
);

describe(
  "core/src/shell/ere.ts: a pattern grep accepts that this reader cannot translate reads as untranslatable, " +
    "never as one that matches nothing, so the production boundary denies on it instead of opening on a " +
    "pattern nothing checked — the reading holds even where grep itself would spare the command",
  () => {
    for (const { pattern, command } of PATTERNS_THE_READER_CANNOT_TRANSLATE) {
      test(`${JSON.stringify(pattern)} is untranslatable over ${JSON.stringify(command)}`, () => {
        assert.equal(ereReads(pattern, command), UNTRANSLATABLE);
      });
    }
  },
);

describe(
  "core/src/shell/ere.ts: a pattern grep exits 2 on matches nothing, exactly as the bash gate's own grep " +
    "does (read from plugin/hooks/block-prod-deploy.sh:130,134)",
  () => {
    for (const { rejected, neighbour, command } of PATTERNS_GREP_REJECTS) {
      test(`${JSON.stringify(rejected)} spares ${JSON.stringify(command)}`, () => {
        assert.equal(ereReads(rejected, command), SPARES);
      });

      test(`${JSON.stringify(neighbour)}, which grep accepts, still bites ${JSON.stringify(command)}`, () => {
        assert.equal(ereReads(neighbour, command), BITES);
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
        assert.equal(ereReads(pattern, command), bites ? BITES : SPARES);
      });
    }
  },
);
