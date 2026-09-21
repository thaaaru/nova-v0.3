import { Annotation, END, interrupt, START, StateGraph } from "@langchain/langgraph";
import type { ApplicationEvidencePackage, ApplicationIdentification, AuthenticationMethod, TestPlan, WorkflowStatus } from "./domain.js";
import { stableHash } from "./domain.js";
import type { IdentificationCache } from "./llm.js";
import { identifyApplication } from "./llm.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export type NovaState = { status: WorkflowStatus; target: string; environment: string; scope: string[]; authentication?: { method: AuthenticationMethod; profileId?: string }; evidence?: ApplicationEvidencePackage; identification?: ApplicationIdentification; plan?: TestPlan; approval?: { approvalId: string; planHash: string; selected: string[] }; audit: Array<{ type: string; at: string; detail?: Record<string, unknown> }> };
const State = Annotation.Root({ value: Annotation<NovaState>({ reducer: (_old, next) => next, default: () => undefined as unknown as NovaState }) });
export type WorkflowDeps = { probeAuthentication(state: NovaState): Promise<boolean>; ensureAuthentication(state: NovaState): Promise<NovaState>; collectEvidence(target: string): Promise<ApplicationEvidencePackage>; discover(state: NovaState): Promise<NovaState>; createPlan(state: NovaState): Promise<TestPlan>; execute(state: NovaState): Promise<NovaState>; model?: BaseChatModel; cache: IdentificationCache };
const update = (state: NovaState, status: WorkflowStatus, audit: string, patch: Partial<NovaState> = {}) => ({ value: { ...state, ...patch, status, audit: [...state.audit, { type: audit, at: new Date().toISOString() }] } });

/** The one canonical orchestration graph. Services do all business work; nodes only transition state. */
export function buildWorkflow(deps: WorkflowDeps) {
  return new StateGraph(State)
    .addNode("resolve_inputs", (s) => update(s.value, "CONTEXT_DISCOVERY", "inputs_resolved"))
    .addNode("probe_entry_context", async (s) => update(s.value, (await deps.probeAuthentication(s.value)) ? "AUTHENTICATION_REQUIRED" : "DOCUMENT_DISCOVERY", "entry_context_probed"))
    .addNode("ensure_authentication", async (s) => ({ value: await deps.ensureAuthentication(s.value) }))
    .addNode("collect_identification_evidence", async (s) => update(s.value, "APPLICATION_IDENTIFICATION", "evidence_collected", { evidence: await deps.collectEvidence(s.value.target) }))
    .addNode("identify_application_with_llm", async (s) => { const result = await identifyApplication(deps.model, s.value.evidence!, deps.cache); return update(s.value, result.value && result.value.confidence >= .75 ? "APPLICATION_DISCOVERY" : "IDENTIFICATION_CONFIRMATION", result.degraded ? "identification_degraded" : "identification_ready", { identification: result.value }); })
    .addNode("confirm_application_identity", (s) => { const decision = interrupt({ kind: "confirm_identity", identification: s.value.identification }); if (decision?.action === "reject") return update(s.value, "STOPPED", "identity_rejected"); return update(s.value, "APPLICATION_DISCOVERY", "identity_confirmed", decision?.identification ? { identification: decision.identification } : {}); })
    .addNode("discover_application", async (s) => ({ value: await deps.discover(s.value) }))
    .addNode("suggest_test_cases", async (s) => update(s.value, "IN_REVIEW", "plan_generated", { plan: await deps.createPlan(s.value) }))
    .addNode("await_approval", (s) => { const decision = interrupt({ kind: "approval", planId: s.value.plan!.id, planHash: stableHash(s.value.plan) }); if (decision.decision === "rejected") return update(s.value, "REJECTED", "plan_rejected"); if (decision.decision === "changes_requested") return update(s.value, "CHANGES_REQUESTED", "changes_requested"); return update(s.value, "APPROVED", "plan_approved", { approval: decision }); })
    .addNode("await_execution_request", (s) => { interrupt({ kind: "execution_request", approval: s.value.approval }); return update(s.value, "PREFLIGHT", "execution_requested"); })
    .addNode("execute_approved_tests", async (s) => ({ value: await deps.execute(s.value) }))
    .addEdge(START, "resolve_inputs").addEdge("resolve_inputs", "probe_entry_context")
    .addConditionalEdges("probe_entry_context", (s) => s.value.status === "AUTHENTICATION_REQUIRED" ? "ensure_authentication" : "collect_identification_evidence", ["ensure_authentication", "collect_identification_evidence"])
    .addEdge("ensure_authentication", "collect_identification_evidence").addEdge("collect_identification_evidence", "identify_application_with_llm")
    .addConditionalEdges("identify_application_with_llm", (s) => s.value.status === "IDENTIFICATION_CONFIRMATION" ? "confirm_application_identity" : "discover_application", ["confirm_application_identity", "discover_application"])
    .addConditionalEdges("confirm_application_identity", (s) => s.value.status === "STOPPED" ? END : "discover_application", [END, "discover_application"])
    .addEdge("discover_application", "suggest_test_cases").addEdge("suggest_test_cases", "await_approval")
    .addConditionalEdges("await_approval", (s) => s.value.status === "APPROVED" ? "await_execution_request" : END, ["await_execution_request", END])
    .addEdge("await_execution_request", "execute_approved_tests").addEdge("execute_approved_tests", END).compile();
}
