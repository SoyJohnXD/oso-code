export type HostName = "claude" | "codex" | "opencode";
export type SkillHost = Extract<HostName, "codex" | "opencode">;

export type OpenCodePermission =
  | "glob"
  | "grep"
  | "edit"
  | "bash"
  | "fallow_fix_apply"
  | "task"
  | "question"
  | "todowrite"
  | "webfetch"
  | "websearch"
  | "oso_wave"
  | "oso_plan_approve"
  | "oso_plan_cancel";

export const OPENCODE_PERMISSION_ORDER: readonly OpenCodePermission[] = [
  "glob",
  "grep",
  "edit",
  "bash",
  "fallow_fix_apply",
  "task",
  "question",
  "todowrite",
  "webfetch",
  "websearch",
  "oso_wave",
  "oso_plan_approve",
  "oso_plan_cancel",
];

export type ClaudeAgentSpec = Readonly<{ description: string; model: string; tools: readonly string[] }>;

export type CodexAgentSpec = Readonly<{ description: string; model: string; reasoningEffort: string; sandboxMode: string }>;

export type OpenCodeAgentSpec = Readonly<{ description: string; denies: readonly OpenCodePermission[] }>;

export type AgentRole = Readonly<{
  id: string;
  claude: ClaudeAgentSpec | null;
  codex: CodexAgentSpec;
  opencode: OpenCodeAgentSpec;
}>;

export function agentHosts(role: AgentRole): readonly HostName[] {
  return role.claude === null ? ["codex", "opencode"] : ["claude", "codex", "opencode"];
}

export const AGENT_ROLES: readonly AgentRole[] = [
  {
    id: "oso-applier",
    claude: { description: "Implements exactly one oso-code assignment — a plan slice, a debt cleanup, judge findings, or a diagnosis packaged as a ledger. Launched by the /plan, /quick and /debug orchestrators — not for direct use.", model: "sonnet", tools: ["Read", "Edit", "Write", "NotebookEdit", "Glob", "Grep", "Bash", "mcp__plugin_oso-code_context7__resolve-library-id", "mcp__plugin_oso-code_context7__query-docs"] },
    codex: { description: "Implements exactly one oso-code assignment: a plan slice, debt cleanup, accepted judge findings, or a diagnosis packaged as a ledger. Launched by the plan, quick, and debug orchestrators; not for direct use.", model: "gpt-5.5", reasoningEffort: "xhigh", sandboxMode: "workspace-write" },
    opencode: { description: "Implements exactly one oso-code assignment: a plan slice, debt cleanup, accepted judge findings, or a diagnosis packaged as a ledger. Launched by the plan, quick, and debug orchestrators; not for direct use.", denies: ["task", "question", "todowrite", "webfetch", "websearch", "oso_wave", "oso_plan_approve", "oso_plan_cancel"] },
  },
  {
    id: "oso-verifier",
    claude: { description: "Independently verifies one implemented slice — or one merged wave at its integration gate — against its criteria and the project's zero-warnings bar. Judges only — never edits files. Launched by the /plan and /debug orchestrators after each apply.", model: "sonnet", tools: ["Read", "Glob", "Grep", "Bash"] },
    codex: { description: "Independently verifies one implemented slice or one merged wave against its criteria and the project's zero-warning bar. Judges only and never edits source files.", model: "gpt-5.5", reasoningEffort: "xhigh", sandboxMode: "workspace-write" },
    opencode: { description: "Independently verifies one implemented slice or one merged wave against its criteria and the project's zero-warning bar. Judges only and never edits source files.", denies: ["edit", "fallow_fix_apply", "task", "question", "todowrite", "webfetch", "websearch", "oso_wave", "oso_plan_approve", "oso_plan_cancel"] },
  },
  {
    id: "oso-integrator",
    claude: { description: "Merges one wave of green, committed slice branches into the main checkout, then tears down their worktrees and deletes those branches. Never resolves a conflict, never judges. Launched by the /plan orchestrator — not for direct use.", model: "sonnet", tools: ["Read", "Bash"] },
    codex: { description: "Merges one wave of green committed slice branches into the main checkout, then removes their worktrees and deletes their branches. Never resolves conflicts and never judges.", model: "gpt-5.5", reasoningEffort: "xhigh", sandboxMode: "danger-full-access" },
    opencode: { description: "Merges one wave of green committed slice branches into the main checkout, then removes their worktrees and deletes their branches. Never resolves conflicts and never judges.", denies: ["edit", "fallow_fix_apply", "task", "question", "todowrite", "webfetch", "websearch", "oso_wave", "oso_plan_approve", "oso_plan_cancel"] },
  },
  {
    id: "oso-debt-sweep",
    claude: null,
    codex: { description: "Fresh-context Codex role for the debt-sweep skill: judges code debt and frozen-ledger conformance separately and never edits.", model: "gpt-5.5", reasoningEffort: "xhigh", sandboxMode: "workspace-write" },
    opencode: { description: "Fresh-context judge for the debt-sweep skill: judges code debt and frozen-ledger conformance separately and never edits.", denies: ["edit", "fallow_fix_apply", "task", "question", "todowrite", "webfetch", "websearch", "oso_wave", "oso_plan_approve", "oso_plan_cancel"] },
  },
  {
    id: "oso-doubt-pass",
    claude: null,
    codex: { description: "Fresh-context Codex role for doubt-pass: attacks a candidate ledger using only intent, surface map, and bare decisions, and never edits.", model: "gpt-5.5", reasoningEffort: "xhigh", sandboxMode: "read-only" },
    opencode: { description: "Fresh-context judge for the doubt-pass skill: attacks a candidate ledger using only intent, surface map, and bare decisions, and never edits.", denies: ["glob", "grep", "edit", "bash", "fallow_fix_apply", "task", "question", "todowrite", "webfetch", "websearch", "oso_wave", "oso_plan_approve", "oso_plan_cancel"] },
  },
  {
    id: "oso-security-reviewer",
    claude: null,
    codex: { description: "Fresh-context Codex role for security-pass: reviews the supplied change surface as a judge and never edits, commits, or asks back.", model: "gpt-5.5", reasoningEffort: "xhigh", sandboxMode: "danger-full-access" },
    opencode: { description: "Fresh-context judge for the security-pass skill: reviews the supplied change surface as a judge and never edits, commits, or asks back.", denies: ["edit", "fallow_fix_apply", "task", "question", "todowrite", "webfetch", "websearch", "oso_wave", "oso_plan_approve", "oso_plan_cancel"] },
  },
  {
    id: "oso-triage",
    claude: null,
    codex: { description: "Fresh-context Codex role for triage: establishes read-only attribution for one red plan-wave check and never diagnoses or fixes beyond it.", model: "gpt-5.5", reasoningEffort: "xhigh", sandboxMode: "workspace-write" },
    opencode: { description: "Fresh-context judge for the triage skill: establishes read-only attribution for one red plan-wave check and never diagnoses or fixes beyond it.", denies: ["edit", "fallow_fix_apply", "task", "question", "todowrite", "webfetch", "websearch", "oso_wave", "oso_plan_approve", "oso_plan_cancel"] },
  },
];

export type SkillStub = Readonly<{
  id: string;
  description: Readonly<Record<SkillHost, string>>;
  argumentHint: Readonly<Record<SkillHost, string>> | null;
  disableModelInvocation: boolean;
}>;

export const SKILL_STUBS: readonly SkillStub[] = [
  {
    id: "debt-sweep",
    description: { codex: "Whole-change judge after functionality is confirmed, on two axes — code debt (dead code, duplication, over-documentation, rubric violations) and ledger conformance (the assembled change against the frozen decisions that shaped it). Reports both with evidence in separate sections — it never edits anything; fixes are applied by a separate applier. Use when a plan-mode change is complete, or when the user asks to sweep a branch or recent work for debt.", opencode: "Whole-change judge after functionality is confirmed, on two axes — code debt (dead code, duplication, over-documentation, rubric violations) and ledger conformance (the assembled change against the frozen decisions that shaped it). Reports both with evidence in separate sections — it never edits anything; fixes are applied by a separate applier. Use when a plan-mode change is complete, or when the user asks to sweep a branch or recent work for debt." },
    argumentHint: { codex: "[base ref, e.g. main] [+ frozen ledger: bare decisions + scope] [+ on re-invocation: every prior finding with its bare disposition]", opencode: "[base ref, e.g. main] [+ frozen ledger: bare decisions + scope] [+ on re-invocation: every prior finding with its bare disposition]" },
    disableModelInvocation: false,
  },
  {
    id: "debug",
    description: { codex: "Debugging and error-recovery mode for something that broke. Triages reproduce-first — reproduce, localize, reduce — then delegates the fix and a regression test through the apply/verify loop with a zero-warnings bar. Use when a bug, crash, or failing behavior needs diagnosis; also the landing point when a plan or quick ask turns out to be a bug.", opencode: "Debugging and error-recovery mode for something that broke. Triages reproduce-first — reproduce, localize, reduce — then delegates the fix and a regression test through the apply/verify loop with a zero-warnings bar. Use when a bug, crash, or failing behavior needs diagnosis; also the landing point when a plan or quick ask turns out to be a bug." },
    argumentHint: { codex: "[what broke]", opencode: "[what is broken]" },
    disableModelInvocation: true,
  },
  {
    id: "doubt-pass",
    description: { codex: "Fresh-context adversarial reviewer of a decision-ledger candidate. Launched by the plan orchestrator pre-freeze on irreversible-blast-radius triggers (migrations, security, or rollback surfaces); also invocable when the operator asks to stress a decision set. Reads only the intent, surface map, and bare decisions — never the author's rationale — and reports what is wrong, missing, or unconsidered. It judges only — never edits, never saves, never asks back.", opencode: "Fresh-context adversarial reviewer of a decision-ledger candidate. Launched by the plan orchestrator pre-freeze on irreversible-blast-radius triggers (migrations, security, or rollback surfaces); also invocable when the operator asks to stress a decision set. Reads only the intent, surface map, and bare decisions — never the author's rationale — and reports what is wrong, missing, or unconsidered. It judges only — never edits, never saves, never asks back." },
    argumentHint: { codex: "[intent + surface map + bare decisions]", opencode: "[intent + surface map + bare decisions]" },
    disableModelInvocation: false,
  },
  {
    id: "plan",
    description: { codex: "Deep mode for substantial changes. Plans in four phases — intent, surface mapping, decision rounds, slicing — inside Plan Mode, closes with a Repaso-headed approval document, then executes slice by slice with an apply/verify loop and a zero-warnings bar. Use for features, refactors, or any change that needs architecture or contract decisions.", opencode: "Deep mode for substantial changes. Plans in four phases — intent, surface mapping, decision rounds, slicing — with nothing written before execution, closes with a Repaso-headed approval document, then executes slice by slice with an apply/verify loop and a zero-warnings bar. Use for features, refactors, or any change that needs architecture or contract decisions." },
    argumentHint: { codex: "[change-name or what to build]", opencode: "[change-name or what to build]" },
    disableModelInvocation: true,
  },
  {
    id: "quality-pass",
    description: { codex: "Readability-only cleanup of touched code after functionality is confirmed. Verifies against the clean-code checklist, fixes what fails, and re-verifies — never changes behavior. Use when a change is functionally done, when the user asks for cleanup or a quality pass, or as the closing step of quick and debug modes.", opencode: "Readability-only cleanup of touched code after functionality is confirmed. Verifies against the clean-code checklist, fixes what fails, and re-verifies — never changes behavior. Use when a change is functionally done, when the user asks for cleanup or a quality pass, or as the closing step of quick and debug modes." },
    argumentHint: null,
    disableModelInvocation: false,
  },
  {
    id: "quick",
    description: { codex: "Fast iteration mode for small, easily verifiable changes. Runs a one-exchange micro-intent, iterates with visible results, and closes with a quality pass. Use for visual tweaks, small fixes, and adjustments that fit in a handful of files.", opencode: "Fast iteration mode for small, easily verifiable changes. Runs a one-exchange micro-intent, iterates with visible results, and closes with a quality pass. Use for visual tweaks, small fixes, and adjustments that fit in a handful of files." },
    argumentHint: { codex: "[what to change]", opencode: "[what to change or fix]" },
    disableModelInvocation: true,
  },
  {
    id: "roadmap",
    description: { codex: "Auto mode for a queue of changes. Plans the whole queue with the operator — the children in order, the decisions that hold across all of them, and the policy that answers what surfaces later — takes one approval for the lot, then plans, executes and closes each child, sets aside any child that hits a decision only the operator can take, and chains the next. Use when several substantial changes are known up front and the operator wants to decide once.", opencode: "Auto mode for a queue of changes. Plans the whole queue with the operator — the children in order, the decisions that hold across all of them, and the policy that answers what surfaces later — takes one approval for the lot, then plans, executes and closes each child, sets aside any child that hits a decision only the operator can take, and chains the next. Use when several substantial changes are known up front and the operator wants to decide once." },
    argumentHint: { codex: "[roadmap name or the changes to queue]", opencode: "[roadmap name or the changes to queue]" },
    disableModelInvocation: true,
  },
  {
    id: "security-pass",
    description: { codex: "Fresh-context security reviewer of a change that has not shipped yet. Launched by the plan, quick, and debug orchestrators on operator acceptance before a commit, a push, or a PR, when the change touched auth, payments, or data-model surfaces. Runs the host's native review path inside its dedicated subagent over the invocation's selected scope. It judges only — never edits, never commits, never asks back.", opencode: "Fresh-context security reviewer of a change that has not shipped yet. Launched by the plan, quick, and debug orchestrators on operator acceptance before a commit, a push, or a PR, when the change touched auth, payments, or data-model surfaces. Runs the host's review path inside its dedicated agent over the invocation's selected scope. It judges only — never edits, never commits, never asks back." },
    argumentHint: { codex: "[optional base ref for a branch range, e.g. main]", opencode: "[optional base ref for a branch range, e.g. main]" },
    disableModelInvocation: false,
  },
  {
    id: "triage",
    description: { codex: "Attribution judge for a check that went red inside a plan wave. Launched by the plan orchestrator's wave loop when the integration gate or a mid-wave check fails on something no slice's diff plainly explains — an orchestrator instrument, never a general debugging entry point. Answers ONE question from read-only git evidence — does this breakage belong to the wave under execution, or does it predate WAVE START, the commit that wave's worktrees were cut from. It judges only — never edits, never fixes, never commits, never asks back; the fix is the operator's call and the debug mode is where they take it.", opencode: "Attribution judge for a check that went red inside a plan wave. Launched by the plan orchestrator's wave loop when the integration gate or a mid-wave check fails on something no slice's diff plainly explains — an orchestrator instrument, never a general debugging entry point. Answers ONE question from read-only git evidence — does this breakage belong to the wave under execution, or does it predate WAVE START, the commit that wave's worktrees were cut from. It judges only — never edits, never fixes, never commits, never asks back; the fix is the operator's call and the debug mode is where they take it." },
    argumentHint: { codex: "[failing check + its evidence verbatim] [+ the wave's slices] [+ WAVE START]", opencode: "[failing check + its evidence verbatim] [+ the wave's slices] [+ WAVE START]" },
    disableModelInvocation: false,
  },
];
