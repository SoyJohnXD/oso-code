import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GIT_VERB_UNRESOLVED, gitVerb, isGitCall, isResidueCall } from "../../src/shell/lexed-command.ts";
import { provedSomething } from "../support/proved.ts";

type VerbCase = { readonly readFrom: string; readonly tokens: readonly string[]; readonly verb: string };

const COMMIT_SUBJECTS = ["git"];

const VERB_CASES: readonly VerbCase[] = [
  { readFrom: "plugin/hooks/lib.sh:188", tokens: ["git", "commit"], verb: "commit" },
  { readFrom: "plugin/hooks/lib.sh:192", tokens: ["git"], verb: "" },
  { readFrom: "plugin/hooks/lib.sh:196", tokens: ["git", "-C", "/repo", "commit"], verb: "commit" },
  { readFrom: "plugin/hooks/lib.sh:196", tokens: ["git", "-c", "user.email=a@b", "commit"], verb: "commit" },
  {
    readFrom: "plugin/hooks/lib.sh:196",
    tokens: ["git", "--git-dir", "/repo", "--work-tree", "/repo", "commit"],
    verb: "commit",
  },
  { readFrom: "plugin/hooks/lib.sh:196", tokens: ["git", "--namespace", "ns", "commit"], verb: "commit" },
  { readFrom: "plugin/hooks/lib.sh:196", tokens: ["git", "--config-env", "user.email=EMAIL", "commit"], verb: "commit" },
  { readFrom: "plugin/hooks/lib.sh:196", tokens: ["git", "--attr-source", "HEAD", "commit"], verb: "commit" },
  { readFrom: "plugin/hooks/lib.sh:203", tokens: ["git", "--help", "commit"], verb: "" },
  { readFrom: "plugin/hooks/lib.sh:203", tokens: ["git", "-h", "commit"], verb: "" },
  { readFrom: "plugin/hooks/lib.sh:203", tokens: ["git", "--version", "commit"], verb: "" },
  { readFrom: "plugin/hooks/lib.sh:203", tokens: ["git", "-v", "commit"], verb: "" },
  { readFrom: "plugin/hooks/lib.sh:204", tokens: ["git", "--exec-path", "commit"], verb: "" },
  { readFrom: "plugin/hooks/lib.sh:177", tokens: ["git", "--exec-path=/usr/lib/git-core", "commit"], verb: "commit" },
  { readFrom: "plugin/hooks/lib.sh:211", tokens: ["git", "-p", "commit"], verb: "commit" },
  { readFrom: "plugin/hooks/lib.sh:211", tokens: ["git", "--no-pager", "commit"], verb: "commit" },
  { readFrom: "plugin/hooks/lib.sh:212", tokens: ["git", "--no-optional-locks", "commit"], verb: "commit" },
  { readFrom: "plugin/hooks/lib.sh:213", tokens: ["git", "--literal-pathspecs", "commit"], verb: "commit" },
  {
    readFrom: "plugin/hooks/lib.sh:183-185",
    tokens: ["git", "--super-prefix", "p/", "commit"],
    verb: GIT_VERB_UNRESOLVED,
  },
];

const GIT_CALL_CASES: readonly (readonly [string, boolean])[] = [
  ["git", true],
  ["git.exe", true],
  ["/usr/bin/git", true],
  ["./git", true],
  ["gitk", false],
  ["npm", false],
];

const RESIDUE_CASES: readonly (readonly [string, readonly string[], string, boolean])[] = [
  ["a command word an expansion leaves unresolved", ["$g", "commit"], "", true],
  ["a git option shape no table answers", ["git", "--super-prefix", "p/", "commit"], "", true],
  ["a git call whose verb the tables do resolve", ["git", "-C", "/repo", "status"], "", false],
  ["an interpreter handed a subject in an argument", ["python3", "-c", "os.system('git commit')"], "", true],
  ["a versioned interpreter handed the same subject", ["python3.13", "-c", "os.system('git commit')"], "", true],
  ["an interpreter handed the subject on stdin", ["python3", "-"], "os.system('git commit')", true],
  ["an interpreter handed no subject at all", ["python3", "deploy.py"], "", false],
  ["a program that is no interpreter this rule names", ["docker", "run", "git"], "", false],
];

provedSomething(
  `at least one of ${VERB_CASES.length} git option-arity cases is exercised`,
  VERB_CASES.length > 0,
  "the git option-arity suite carries no case, so it proved nothing about plugin/hooks/lib.sh",
);

describe("core/src/shell/lexed-command.ts: port tests read from plugin/hooks/lib.sh:162-258, never parity evidence", () => {
  for (const { readFrom, tokens, verb } of VERB_CASES) {
    test(`${tokens.join(" ")} resolves the verb ${verb === "" ? "<none>" : verb} (read from ${readFrom})`, () => {
      assert.equal(gitVerb({ tokens, stdin: "" }), verb);
    });
  }

  for (const [commandWord, isGit] of GIT_CALL_CASES) {
    test(`${commandWord} ${isGit ? "is" : "is not"} a git call (read from plugin/hooks/lib.sh:166-168)`, () => {
      assert.equal(isGitCall({ tokens: [commandWord], stdin: "" }), isGit);
    });
  }

  for (const [reads, tokens, stdin, isResidue] of RESIDUE_CASES) {
    test(`${reads} ${isResidue ? "spends" : "spends no"} residue (read from plugin/hooks/lib.sh:218-258)`, () => {
      assert.equal(isResidueCall({ tokens, stdin }, COMMIT_SUBJECTS), isResidue);
    });
  }
});
