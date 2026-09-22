import { randomUUID } from "node:crypto";
import type { DiscoverySummary } from "./discovery.js";
import type { ApplicationProbeInventory } from "./app-probe.js";
import { sanitizeEvidence } from "./evidence.js";
import type { ApplicationEvidencePackage, TestPlan } from "./domain.js";

export function buildDiscoveryEvidence(target: string, discovery: DiscoverySummary, probe?: ApplicationProbeInventory): ApplicationEvidencePackage {
  return sanitizeEvidence(target, [
    ...discovery.routes.map((route) => ({ sourceType: "route", source: route, content: new URL(route).pathname })),
    ...discovery.titles.map((title, index) => ({ sourceType: "page-title", source: discovery.routes[index] ?? target, content: title })),
    ...discovery.headings.map((heading) => ({ sourceType: "page-heading", source: target, content: heading })),
    ...discovery.controls.map((control) => ({ sourceType: control.kind, source: control.route ?? target, content: control.label || control.route || control.kind })),
    ...discovery.apiOperations.map((operation) => ({ sourceType: "api-operation", source: operation.path, content: `${operation.method} ${operation.path} → ${operation.status ?? "unknown"}` })),
    ...(probe?.pages.flatMap((page) => [
      ...page.headings.map((heading) => ({ sourceType: "probe-heading", source: page.route, content: heading })),
      ...page.forms.map((form) => ({ sourceType: "probe-form", source: page.route, content: `${form.method} form with ${form.fields} visible fields` })),
      ...page.links.map((link) => ({ sourceType: "probe-link", source: page.route, content: link })),
    ]) ?? []),
  ]);
}

/** Rule-generated candidates only. They are reviewable suggestions, never executable authority. */
export function suggestDeterministicTests(target: string, environment: string, scope: string[], discovery: DiscoverySummary, evidence: ApplicationEvidencePackage): TestPlan {
  const routeEvidence = evidence.evidence.filter((item) => item.sourceType === "route");
  const cases = routeEvidence.map((item, index) => ({
    id: `TC-${String(index + 1).padStart(3, "0")}`, area: "Application navigation", journey: "Route availability", persona: "Authenticated user",
    name: `Load ${item.content === "/" ? "application home" : item.content}`, type: "navigation", priority: "medium" as const,
    preconditions: discovery.authenticationUsed ? ["Valid authenticated session"] : [], steps: [`Navigate to ${item.source}`],
    expectedResult: "The route loads without an access or server error.", sideEffect: "read_only" as const,
    evidenceRefs: [item.evidenceId], rationale: "Observed during bounded discovery.", confidence: 1, source: "rule" as const,
  }));
  if (!cases.length) throw new Error("Discovery yielded no evidence-backed routes to plan.");
  return { id: randomUUID(), version: 1, target, environment, scope, cases };
}
