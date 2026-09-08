import assert from "node:assert/strict";
import { test } from "node:test";
import { codexLoginStatus } from "./support/codex-integrator-drive.ts";
import { CODEX_CERTIFY_GUARD } from "./support/certify-guard.ts";
import { notRun } from "./support/not-run.ts";
import {
  CODEX_STOP_CERTIFY_OPT_IN,
  CODEX_STOP_PROBE_BOUND_SECONDS,
  runCodexStopProbe,
} from "./support/codex-stop-drive.ts";

const STOP_PROBE_ENABLED = process.env[CODEX_STOP_CERTIFY_OPT_IN] === "1";

test("Codex exec performs a first response, one native continuation, and a final Stop without user input", CODEX_CERTIFY_GUARD, (t) => {
  if (!STOP_PROBE_ENABLED) {
    notRun(t, `set ${CODEX_STOP_CERTIFY_OPT_IN}=1 to authorize the read-only Codex Stop probe`);
    return;
  }
  const login = codexLoginStatus(process.env, 20);
  if (!login.ok) {
    notRun(t, "Codex authentication is unavailable; login status did not report authenticated access");
    return;
  }
  const result = runCodexStopProbe(process.env, CODEX_STOP_PROBE_BOUND_SECONDS);
  assert.equal(result.kind, "measured", result.kind === "invalid" ? result.reason : result.kind === "not-run" ? result.reason : "");
});

test(
  "installed Codex TUI Stop behavior remains an explicit unmeasured certification row",
  CODEX_CERTIFY_GUARD,
  (t) => notRun(t, "this bounded lane measures codex exec only, not the installed interactive TUI"),
);
