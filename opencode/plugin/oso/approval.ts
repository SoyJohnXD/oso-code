import {
  GatesOwnedElsewhereError,
  PlanApprovalError,
  PlanFailure,
  runApprovePlan,
  runCancelApprovedPlan,
  runCapturePlan,
  sha256Hex,
} from "@oso-code/core";
import { deriveRootId } from "./identity.ts";
import { approvedPlanFor } from "./plan-state.ts";
import { DIRECT_CALL, type OsoTool, type OsoToolContext, type ToolHost } from "./tool.ts";

export const PLAN_APPROVAL_TOOL_ID = "oso_plan_approve";
export const PLAN_CANCEL_TOOL_ID = "oso_plan_cancel";

export function planApprovalTool(host: ToolHost): OsoTool {
  return {
    name: PLAN_APPROVAL_TOOL_ID,
    description: "The approval gate for the oso-code plan mode's phases 1 through 5. Deliver the complete phase-5"
      + " document as turn-ending plain text first, then call this tool in a later turn carrying those exact bytes."
      + " The operator's answer to the authorization prompt this raises IS the approval: a grant records the"
      + " approved plan and opens the amendment lane against it, and a refusal comes back as an error approving"
      + " nothing — the presentation captured before the prompt stays on disk unpromoted, so this repository is"
      + " left exactly as unapproved as it was. Nothing this session says or writes can stand in for that answer,"
      + " and no earlier grant carries over to a later call. A material change to the document invalidates the"
      + " approval it already carries:"
      + " present the whole plan again and call this tool again, which binds a fresh digest.",
    input: {
      type: "object",
      properties: {
        plan: {
          type: "string",
          description: "The complete phase-5 document, byte for byte as the operator just read it.",
        },
      },
      required: ["plan"],
    },
    options: DIRECT_CALL,
    execute: async (input, call) => approveOnOperatorGrant(host, planDocumentOf(input), call),
  };
}

export function planCancelTool(host: ToolHost): OsoTool {
  return {
    name: PLAN_CANCEL_TOOL_ID,
    description: "Abandons the approved plan this repository is executing, at the operator's explicit request and"
      + " never on your own reading of one. The operator's answer to the authorization prompt this raises IS the"
      + " abandonment. A grant writes mode=plan, active_slice=none, verify_green=false and plan_approval=cancelled,"
      + " which closes the edit and commit gates and leaves nothing for the amendment lane to amend; the approved"
      + " document, the run's own markers and every other state key are left exactly as they stand. Call it only"
      + " when the operator asks to abandon the plan, never to unstick a denied tool call.",
    input: { type: "object", properties: {}, required: [] },
    options: DIRECT_CALL,
    execute: async (_input, call) => cancelOnOperatorGrant(host, call),
  };
}

type ToolResult = Awaited<ReturnType<OsoTool["execute"]>>;

async function approveOnOperatorGrant(host: ToolHost, planDocument: string, call: OsoToolContext): Promise<ToolResult> {
  const directory = await host.directoryOf(call.sessionID);
  const owner = deriveRootId(directory);
  const digest = sha256Hex(planDocument);
  runCapturePlan(directory, owner, digest, planDocument);
  await askOperator(host, call, PLAN_APPROVAL_TOOL_ID, digest, { digest, characters: planDocument.length });
  promoteThePresentedPlan(directory, owner, digest);
  return {
    content: `The operator granted ${PLAN_APPROVAL_TOOL_ID} for the plan document whose digest is ${digest}.`
      + ` Execution may begin against that exact document, and the operational plan is amendable under ${owner}.`,
    metadata: { digest, owner, session: call.sessionID },
  };
}

async function cancelOnOperatorGrant(host: ToolHost, call: OsoToolContext): Promise<ToolResult> {
  const directory = await host.directoryOf(call.sessionID);
  const owner = deriveRootId(directory);
  const approved = approvedPlanFor(directory, owner);
  if (approved.kind !== "approved") {
    throw new Error(`${PLAN_CANCEL_TOOL_ID} has no approved plan to abandon: ${approved.detail}`);
  }
  await askOperator(host, call, PLAN_CANCEL_TOOL_ID, approved.digest, { digest: approved.digest });
  abandonTheApprovedPlan(directory, owner, approved.digest);
  return {
    content: `The operator granted ${PLAN_CANCEL_TOOL_ID} for the approved plan whose digest is ${approved.digest}.`
      + " Its state now reads plan_approval=cancelled beside the disarmed triple, so no slice is armed, no commit"
      + " passes the green gate and no amendment lands; the approved document itself is untouched.",
    metadata: { digest: approved.digest, session: call.sessionID },
  };
}

function askOperator(
  host: ToolHost,
  call: OsoToolContext,
  action: string,
  digest: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  return host.permission.assert({
    sessionID: call.sessionID,
    agent: call.agent,
    action,
    resources: [digest],
    metadata,
    source: { type: "tool", messageID: call.messageID, id: call.id },
  });
}

function promoteThePresentedPlan(directory: string, owner: string, digest: string): void {
  try {
    runApprovePlan(directory, owner, digest);
  } catch (err) {
    if (!(err instanceof PlanApprovalError) && !(err instanceof PlanFailure)) throw err;
    throw new Error(`${PLAN_APPROVAL_TOOL_ID} did not record the operator's approval: ${err.message}`);
  }
}

function abandonTheApprovedPlan(directory: string, owner: string, digest: string): void {
  try {
    runCancelApprovedPlan(directory, owner, digest);
  } catch (err) {
    if (!(err instanceof PlanApprovalError) && !(err instanceof GatesOwnedElsewhereError)) throw err;
    throw new Error(`${PLAN_CANCEL_TOOL_ID} did not abandon the plan: ${err.message}`);
  }
}

function planDocumentOf(args: unknown): string {
  const plan = (args as { plan?: unknown } | null | undefined)?.plan;
  if (typeof plan !== "string" || plan.trim() === "") {
    throw new Error(`${PLAN_APPROVAL_TOOL_ID} needs the plan document it is asking the operator to approve`);
  }
  return plan;
}
