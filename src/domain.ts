import { createHash } from "node:crypto";
import { z } from "zod";

export const WorkflowStatusSchema = z.enum([
  "NEW", "CONTEXT_DISCOVERY", "AUTHENTICATION_REQUIRED", "AUTHENTICATED", "DOCUMENT_DISCOVERY",
  "APPLICATION_IDENTIFICATION", "IDENTIFICATION_CONFIRMATION", "APPLICATION_DISCOVERY", "DISCOVERED",
  "PLAN_GENERATING", "IN_REVIEW", "APPROVED", "CHANGES_REQUESTED", "REJECTED", "EXECUTION_REQUESTED",
  "PREFLIGHT", "RUNNING", "PAUSED", "STOPPED", "COMPLETED", "FAILED",
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const AuthenticationMethodSchema = z.enum(["browser", "saved_profile", "public_only"]);
export type AuthenticationMethod = z.infer<typeof AuthenticationMethodSchema>;
export const AuthenticationProfileSchema = z.object({
  id: z.string().uuid(), projectId: z.string().min(1), environment: z.string().min(1), targetOrigin: z.string().url(),
  createdAt: z.string().datetime(), expiresAt: z.string().datetime().optional(), method: z.literal("browser"),
});
export type AuthenticationProfile = z.infer<typeof AuthenticationProfileSchema>;

export const EvidenceItemSchema = z.object({
  evidenceId: z.string().regex(/^E-\d{3,}$/), sourceType: z.string().min(1), source: z.string().max(500),
  content: z.string().min(1).max(1_000),
});
export const ApplicationEvidencePackageSchema = z.object({
  version: z.literal(1), target: z.string().url(), evidence: z.array(EvidenceItemSchema).max(100), hash: z.string(),
});
export type ApplicationEvidencePackage = z.infer<typeof ApplicationEvidencePackageSchema>;

const EvidenceRefs = z.array(z.string().regex(/^E-\d{3,}$/)).min(1).max(20);
export const ApplicationIdentificationSchema = z.object({
  applicationName: z.string().min(1).max(120), applicationType: z.string().min(1).max(160),
  businessDomain: z.string().max(120).nullable(), primaryPurpose: z.string().min(1).max(500),
  likelyPersonas: z.array(z.object({ name: z.string().min(1), evidenceRefs: EvidenceRefs })).max(20),
  coreEntities: z.array(z.object({ name: z.string().min(1), evidenceRefs: EvidenceRefs })).max(30),
  functionalAreas: z.array(z.object({ name: z.string().min(1), evidenceRefs: EvidenceRefs })).max(30),
  likelyJourneys: z.array(z.object({ name: z.string().min(1), evidenceRefs: EvidenceRefs })).max(30),
  authenticationPattern: z.object({ type: z.string().min(1), evidenceRefs: EvidenceRefs }).nullable(),
  relevantDocuments: z.array(z.string()).max(30), assumptions: z.array(z.string()).max(20), unknowns: z.array(z.string()).max(20),
  confidence: z.number().min(0).max(1), evidenceRefs: EvidenceRefs,
});
export type ApplicationIdentification = z.infer<typeof ApplicationIdentificationSchema>;

export const TestCaseSchema = z.object({
  id: z.string().min(1), area: z.string(), journey: z.string(), persona: z.string(), name: z.string(),
  type: z.string(), priority: z.enum(["low", "medium", "high"]), preconditions: z.array(z.string()),
  fixtureRef: z.string().optional(), steps: z.array(z.string()).min(1), expectedResult: z.string(),
  sideEffect: z.enum(["read_only", "state_changing"]), evidenceRefs: EvidenceRefs, rationale: z.string(),
  confidence: z.number().min(0).max(1), source: z.enum(["rule", "llm", "combined"]),
});
export type TestCase = z.infer<typeof TestCaseSchema>;
export const TestPlanSchema = z.object({ id: z.string().uuid(), version: z.number().int().positive(), target: z.string().url(), environment: z.string(), scope: z.array(z.string()).min(1), cases: z.array(TestCaseSchema).min(1) });
export type TestPlan = z.infer<typeof TestPlanSchema>;

export const ApprovalSubmissionSchema = z.object({ planId: z.string().uuid(), planHash: z.string().regex(/^[a-f0-9]{64}$/), decision: z.enum(["approved", "changes_requested", "rejected"]), selectedTestCaseIds: z.array(z.string()), excludedTestCaseIds: z.array(z.string()), comment: z.string().max(2_000) });
export type ApprovalSubmission = z.infer<typeof ApprovalSubmissionSchema>;

export function stableHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
