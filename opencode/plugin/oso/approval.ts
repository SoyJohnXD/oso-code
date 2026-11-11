import {
  GatesOwnedElsewhereError,
  heldPlanOf,
  PlanApprovalError,
  planDeltaDigestOf,
  PlanDeltaError,
  planDeltaOf,
  planDeltaSummaryOf,
  PlanFailure,
  presentedPlanOf,
  refuseReplacingAHeldPlanWhileASliceIsActive,
  renderPlanDelta,
  runApprovePlan,
  runCancelApprovedPlan,
  runCapturePlan,
  runPresentPlan,
  runSupersedePlan,
  sha256Hex,
  type HeldPlan,
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
      + " and no earlier grant carries over to a later call. When a plan is already held and you pass a changed"
      + " document, the first call returns the delta the harness computed and changes no plan state. Relay that"
      + " delta as turn-ending text. Then call again in a later turn with the identical plan to raise the"
      + " authorization prompt. The grant binds the digest of the full new document.",
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

type PlanPresentation = Readonly<{
  host: ToolHost;
  call: OsoToolContext;
  directory: string;
  owner: string;
  digest: string;
  plan: string;
}>;

type HeldDocument = Extract<HeldPlan, { kind: "held" }>;

async function approveOnOperatorGrant(host: ToolHost, plan: string, call: OsoToolContext): Promise<ToolResult> {
  const directory = await host.directoryOf(call.sessionID);
  const presentation = { host, call, directory, owner: deriveRootId(directory), digest: sha256Hex(plan), plan };
  const held = heldPlanReadingOf(directory);
  if (held.kind === "unreadable") return approveTheWholePlan(presentation, held.cause);
  if (held.kind === "none") return approveTheWholePlan(presentation);
  if (held.digest === presentation.digest) {
    return held.approval === "approved" ? alreadyApproved(presentation) : approveTheWholePlan(presentation);
  }
  const presented = presentedPlanOf(directory);
  if (presented?.digest !== presentation.digest || presented.base !== held.digest) {
    return presentTheDelta(presentation, held);
  }
  return supersedeOnOperatorGrant(presentation, held, presented.turn);
}

function heldPlanReadingOf(directory: string): HeldPlan | Readonly<{ kind: "unreadable"; cause: string }> {
  try {
    return heldPlanOf(directory);
  } catch (err) {
    if (!(err instanceof PlanFailure)) throw err;
    return { kind: "unreadable", cause: err.message };
  }
}

async function approveTheWholePlan(presentation: PlanPresentation, unavailableDelta?: string): Promise<ToolResult> {
  const { host, call, directory, owner, digest, plan } = presentation;
  refuseReplacingAHeldPlanWhileASliceIsActive(directory, PLAN_APPROVAL_TOOL_ID);
  runCapturePlan(directory, owner, digest, plan);
  await askOperator(host, call, PLAN_APPROVAL_TOOL_ID, digest, { digest, characters: plan.length });
  promoteThePresentedPlan(directory, owner, digest);
  const granted = `The operator granted ${PLAN_APPROVAL_TOOL_ID} for the plan document whose digest is ${digest}.`
    + ` Execution may begin against that exact document, and the operational plan is amendable under ${owner}.`;
  const metadata = { digest, owner, session: call.sessionID };
  if (unavailableDelta === undefined) return { content: granted, metadata };
  return {
    content: `The plan delta was unavailable, so the whole plan went to the operator instead: ${unavailableDelta}.`
      + ` Tell the operator the delta was unavailable and why. ${granted}`,
    metadata: { ...metadata, deltaUnavailable: unavailableDelta },
  };
}

function alreadyApproved({ call, owner, digest }: PlanPresentation): ToolResult {
  return {
    content: `${PLAN_APPROVAL_TOOL_ID} raised no prompt: the plan document whose digest is ${digest} is already the`
      + " approved plan, so nothing changed.",
    metadata: { digest, owner, session: call.sessionID },
  };
}

async function presentTheDelta(presentation: PlanPresentation, held: HeldDocument): Promise<ToolResult> {
  const delta = deltaAgainst(held, presentation.plan);
  recordThePresentation(presentation);
  const metadata = { step: "delta", digest: presentation.digest, base: held.digest, ...deltaMetadataOf(delta) };
  const callAgain = `Then call ${PLAN_APPROVAL_TOOL_ID} again in a LATER turn with the identical plan bytes. This`
    + ` call changed no plan state, and the held plan whose digest is ${held.digest} stays in force.`;
  if (delta.kind === "unavailable") {
    return {
      content: `${PLAN_APPROVAL_TOOL_ID} raised no prompt: a plan is already held, but the delta could not be`
        + ` computed: ${delta.cause}. The operator already has the whole plan as your own turn-ending text, so tell`
        + " them the delta was unavailable and why, and that confirming will approve the whole new document."
        + ` ${callAgain}`,
      metadata,
    };
  }
  return {
    content: `${PLAN_APPROVAL_TOOL_ID} raised no prompt: a plan is already held, so this call returns the delta the`
      + ` harness computed. Relay the delta below to the operator VERBATIM as turn-ending plain text. ${callAgain}`
      + `\n\n${delta.text}`,
    metadata,
  };
}

async function supersedeOnOperatorGrant(
  presentation: PlanPresentation,
  held: HeldDocument,
  presentedTurn: string,
): Promise<ToolResult> {
  const { host, call, directory, owner, digest, plan } = presentation;
  if (presentedTurn === call.messageID) {
    throw new Error(`${PLAN_APPROVAL_TOOL_ID} returned the delta for this document earlier in this same turn. Relay`
      + " it to the operator as turn-ending plain text, then call again in a LATER turn with the identical plan.");
  }
  refuseReplacingAHeldPlanWhileASliceIsActive(directory, PLAN_APPROVAL_TOOL_ID);
  const delta = deltaAgainst(held, plan);
  const summary = delta.kind === "computed" ? { summary: delta.summary } : {};
  await askOperator(host, call, PLAN_APPROVAL_TOOL_ID, digest, {
    digest,
    characters: plan.length,
    base: held.digest,
    ...deltaMetadataOf(delta),
    ...summary,
  });
  supersedeTheHeldPlan(directory, owner, digest);
  const through = delta.kind === "computed"
    ? `through the delta whose digest is ${delta.digest}`
    : `with no delta digest, because the delta could not be computed: ${delta.cause}`;
  return {
    content: `The operator granted ${PLAN_APPROVAL_TOOL_ID} for the plan document whose digest is ${digest}, over`
      + ` the base plan whose digest is ${held.digest}, ${through}. The new document superseded the previous plan,`
      + " whose snapshot stays on disk as history, and the operational plan is amendable under"
      + ` ${owner}. Update the Engram oso/{change}/plan topic with the new document.`,
    metadata: { digest, owner, session: call.sessionID, base: held.digest, ...deltaMetadataOf(delta) },
  };
}

type DeltaReading =
  | Readonly<{ kind: "computed"; text: string; digest: string; summary: string }>
  | Readonly<{ kind: "unavailable"; cause: string }>;

function deltaAgainst(held: HeldDocument, plan: string): DeltaReading {
  try {
    const delta = planDeltaOf({ base: held.document, next: plan, current: held.current });
    return {
      kind: "computed",
      text: renderPlanDelta(delta),
      digest: planDeltaDigestOf(delta),
      summary: planDeltaSummaryOf(delta),
    };
  } catch (err) {
    if (!(err instanceof PlanDeltaError)) throw err;
    return { kind: "unavailable", cause: err.message };
  }
}

function deltaMetadataOf(delta: DeltaReading): Readonly<{ deltaDigest: string } | { deltaUnavailable: string }> {
  return delta.kind === "computed" ? { deltaDigest: delta.digest } : { deltaUnavailable: delta.cause };
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

function recordThePresentation({ call, directory, owner, digest, plan }: PlanPresentation): void {
  try {
    runPresentPlan(directory, owner, digest, plan, call.messageID);
  } catch (err) {
    if (!(err instanceof PlanFailure) && !(err instanceof GatesOwnedElsewhereError)) throw err;
    throw new Error(`${PLAN_APPROVAL_TOOL_ID} did not present the changed plan: ${err.message}`);
  }
}

function supersedeTheHeldPlan(directory: string, owner: string, digest: string): void {
  try {
    runSupersedePlan(directory, owner, digest);
  } catch (err) {
    if (!(err instanceof PlanFailure) && !(err instanceof GatesOwnedElsewhereError)) throw err;
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
