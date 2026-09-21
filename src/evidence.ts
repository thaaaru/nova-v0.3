import type { ApplicationEvidencePackage } from "./domain.js";
import { ApplicationEvidencePackageSchema, stableHash } from "./domain.js";

const SECRET = /(?:api[_-]?key|authorization|bearer|token|password|secret|cookie)\s*[:=]\s*[^\s"']+/gi;
const INSTRUCTION = /(?:ignore (?:all |previous )?instructions|system prompt|you are chatgpt|run this command)/gi;

/** Converts discovery observations into bounded data, never instructions for a model. */
export function sanitizeEvidence(target: string, observations: Array<{ sourceType: string; source: string; content: string }>): ApplicationEvidencePackage {
  const evidence = observations.slice(0, 100).map((item, index) => ({
    evidenceId: `E-${String(index + 1).padStart(3, "0")}`,
    sourceType: item.sourceType.slice(0, 80), source: item.source.slice(0, 500),
    content: item.content.replace(SECRET, "[REDACTED]").replace(INSTRUCTION, "[UNTRUSTED CONTENT REMOVED]").slice(0, 1_000),
  })).filter((item) => item.content.trim().length > 0);
  return ApplicationEvidencePackageSchema.parse({ version: 1, target, evidence, hash: stableHash({ target, evidence }) });
}
