import { writeFileSync } from "node:fs";
import {
  LEXER_DIFFERENTIAL_FIXTURE,
  lexerDifferentialFromTheRealShell,
} from "../test/support/lexer-differential.ts";

const observed = lexerDifferentialFromTheRealShell();
writeFileSync(LEXER_DIFFERENTIAL_FIXTURE, `${JSON.stringify(observed, undefined, 2)}\n`);
process.stdout.write(
  `oso-code: ${observed.argvProbes.length} argv probe(s) and ${observed.equivalences.length} ` +
    `equivalence pair(s) recorded from ${observed.oracle} into ${LEXER_DIFFERENTIAL_FIXTURE}\n`,
);
