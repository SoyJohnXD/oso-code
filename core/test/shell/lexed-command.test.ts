import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GIT_VERB_UNRESOLVED, gitVerb, isGitCall, isResidueCall } from "../../src/shell/lexed-command.ts";
import { provedSomething } from "../support/proved.ts";

type VerbCase = { readonly tokens: readonly string[]; readonly verb: string };

const COMMIT_SUBJECTS = ["git"];

const VERB_CASES: readonly VerbCase[] = [
  { tokens: ["git", "commit"], verb: "commit" },
  { tokens: ["git"], verb: "" },
  { tokens: ["git", "-C", "/repo", "commit"], verb: "commit" },
  { tokens: ["git", "-c", "user.email=a@b", "commit"], verb: "commit" },
  {
    tokens: ["git", "--git-dir", "/repo", "--work-tree", "/repo", "commit"],
    verb: "commit",
  },
  { tokens: ["git", "--namespace", "ns", "commit"], verb: "commit" },
  { tokens: ["git", "--config-env", "user.email=EMAIL", "commit"], verb: "commit" },
  { tokens: ["git", "--attr-source", "HEAD", "commit"], verb: "commit" },
  { tokens: ["git", "--help", "commit"], verb: "" },
  { tokens: ["git", "-h", "commit"], verb: "" },
  { tokens: ["git", "--version", "commit"], verb: "" },
  { tokens: ["git", "-v", "commit"], verb: "" },
  { tokens: ["git", "--exec-path", "commit"], verb: "" },
  { tokens: ["git", "--exec-path=/usr/lib/git-core", "commit"], verb: "commit" },
  { tokens: ["git", "-p", "commit"], verb: "commit" },
  { tokens: ["git", "--no-pager", "commit"], verb: "commit" },
  { tokens: ["git", "--no-optional-locks", "commit"], verb: "commit" },
  { tokens: ["git", "--literal-pathspecs", "commit"], verb: "commit" },
  {
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
  "the git option-arity suite carries no case, so it proved nothing about how a git verb resolves",
);

describe("core/src/shell/lexed-command.ts: git verb resolution, git-call recognition and residue", () => {
  for (const { tokens, verb } of VERB_CASES) {
    test(`${tokens.join(" ")} resolves the verb ${verb === "" ? "<none>" : verb}`, () => {
      assert.equal(gitVerb({ tokens, stdin: "" }), verb);
    });
  }

  for (const [commandWord, isGit] of GIT_CALL_CASES) {
    test(`${commandWord} ${isGit ? "is" : "is not"} a git call`, () => {
      assert.equal(isGitCall({ tokens: [commandWord], stdin: "" }), isGit);
    });
  }

  for (const [reads, tokens, stdin, isResidue] of RESIDUE_CASES) {
    test(`${reads} ${isResidue ? "spends" : "spends no"} residue`, () => {
      assert.equal(isResidueCall({ tokens, stdin }, COMMIT_SUBJECTS), isResidue);
    });
  }
});
