import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  TOML_REGION_DIFFERENTIAL_FIXTURE,
  tomlRegionDifferentialFromTheRealAwk,
} from "../test/support/toml-region-differential.ts";

const observed = tomlRegionDifferentialFromTheRealAwk();
mkdirSync(path.dirname(TOML_REGION_DIFFERENTIAL_FIXTURE), { recursive: true });
writeFileSync(TOML_REGION_DIFFERENTIAL_FIXTURE, `${JSON.stringify(observed, undefined, 2)}\n`);
process.stdout.write(
  `oso-code: ${observed.cases.length} case(s) recorded from ${observed.oracle} ` +
    `(${observed.awkVersion}) into ${TOML_REGION_DIFFERENTIAL_FIXTURE}\n`,
);
