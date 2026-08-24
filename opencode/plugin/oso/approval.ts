import { commonDirOf, deriveRootId } from "./identity.ts";
import { approvePlan, capturePlan } from "./plan.ts";
import { armApprovedPlan, approvedPlanFor, cancelApprovedPlan } from "./plan-state.ts";
import type { HostPermissionRequest, PluginTool, PluginToolCall, PluginToolResult } from "./tool.ts";

export const PLAN_APPROVAL_TOOL_ID = "oso_plan_approve";
export const PLAN_CANCEL_TOOL_ID = "oso_plan_cancel";

export function planApprovalTool(): PluginTool {
  return {
    description: "The approval gate for the oso-code plan mode's phases 1 through 5. Deliver the complete phase-5"
      + " document as turn-ending plain text first, then call this tool in a later turn carrying those exact bytes."
      + " The operator's answer to the authorization prompt this raises IS the approval: a grant records the"
      + " approved plan and opens the amendment lane against it, and a refusal comes back as an error approving"
      + " nothing — the presentation captured before the prompt stays on disk unpromoted, so this repository is"
      + " left exactly as unapproved as it was. Nothing this session says or writes can stand in for that answer,"
      + " and no earlier grant carries over to a later call. A material change to the document invalidates the"
      + " approval it already carries:"
      + " present the whole plan again and call this tool again, which binds a fresh digest.",
    args: {
      plan: {
        type: "string",
        description: "The complete phase-5 document, byte for byte as the operator just read it.",
      },
    },
    execute: async (args, call) => approveOnOperatorGrant(planDocumentOf(args), call),
  };
}

export function planCancelTool(): PluginTool {
  return {
    description: "Abandons the approved plan this repository is executing, at the operator's explicit request and"
      + " never on your own reading of one. The operator's answer to the authorization prompt this raises IS the"
      + " abandonment. A grant writes mode=plan, active_slice=none, verify_green=false and plan_approval=cancelled,"
      + " which closes the edit and commit gates and leaves nothing for the amendment lane to amend; the approved"
      + " document, the run's own markers and every other state key are left exactly as they stand. Call it only"
      + " when the operator asks to abandon the plan, never to unstick a denied tool call.",
    args: {},
    execute: async (_args, call) => cancelOnOperatorGrant(call),
  };
}

interface GrantBoundCall {
  askOperator: (request: HostPermissionRequest) => Promise<unknown>;
  directory: string;
  commonDir: string;
  owner: string;
  sessionID: string;
}

async function approveOnOperatorGrant(planDocument: string, call: PluginToolCall): Promise<PluginToolResult> {
  const { askOperator, directory, commonDir, owner, sessionID } = grantBoundCall(PLAN_APPROVAL_TOOL_ID, call);
  const { digest } = capturePlan(commonDir, owner, planDocument);
  await askOperator({
    permission: PLAN_APPROVAL_TOOL_ID,
    patterns: [digest],
    always: [],
    metadata: { digest, characters: planDocument.length },
  });
  const verdict = approvePlan(commonDir, digest, owner);
  if (!verdict.ok) {
    throw new Error(
      `${PLAN_APPROVAL_TOOL_ID} did not record the operator's approval: ${verdict.error ?? "the presented plan could not be promoted"}`,
    );
  }
  armApprovedPlan({ directory, commonDir, owner, digest });
  return {
    title: "plan approved",
    output: `The operator granted ${PLAN_APPROVAL_TOOL_ID} for the plan document whose digest is ${digest}.`
      + ` Execution may begin against that exact document, and the operational plan is amendable under ${owner}.`,
    metadata: { digest, owner, session: sessionID },
  };
}

async function cancelOnOperatorGrant(call: PluginToolCall): Promise<PluginToolResult> {
  const { askOperator, directory, owner, sessionID } = grantBoundCall(PLAN_CANCEL_TOOL_ID, call);
  const approved = approvedPlanFor(directory, owner);
  if (approved.kind !== "approved") {
    throw new Error(`${PLAN_CANCEL_TOOL_ID} has no approved plan to abandon: ${approved.detail}`);
  }
  await askOperator({
    permission: PLAN_CANCEL_TOOL_ID,
    patterns: [approved.digest],
    always: [],
    metadata: { digest: approved.digest },
  });
  cancelApprovedPlan(directory, owner);
  return {
    title: "plan abandoned",
    output: `The operator granted ${PLAN_CANCEL_TOOL_ID} for the approved plan whose digest is ${approved.digest}.`
      + " Its state now reads plan_approval=cancelled beside the disarmed triple, so no slice is armed, no commit"
      + " passes the green gate and no amendment lands; the approved document itself is untouched.",
    metadata: { digest: approved.digest, session: sessionID },
  };
}

function grantBoundCall(toolId: string, call: PluginToolCall): GrantBoundCall {
  const askOperator = call.ask;
  if (askOperator === undefined) {
    throw new Error(
      `${toolId} cannot run: this host handed the plugin no permission API to raise the operator's approval with`,
    );
  }
  const sessionID = call.sessionID ?? "";
  if (sessionID === "") {
    throw new Error(`${toolId} cannot run: the host named no session to raise the operator's prompt in`);
  }
  const directory = call.directory ?? "";
  const commonDir = commonDirOf(directory);
  if (commonDir === "") {
    throw new Error(
      `${toolId} must run inside a git repository, and ${directory || "the directory the host named"} is not one`,
    );
  }
  return { askOperator, directory, commonDir, owner: deriveRootId(directory), sessionID };
}

function planDocumentOf(args: unknown): string {
  const plan = (args as { plan?: unknown } | null | undefined)?.plan;
  if (typeof plan !== "string" || plan.trim() === "") {
    throw new Error(`${PLAN_APPROVAL_TOOL_ID} needs the plan document it is asking the operator to approve`);
  }
  return plan;
}
