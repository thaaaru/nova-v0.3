import { describe, expect, it } from "vitest";
import { buildDiscoveryEvidence, suggestDeterministicTests } from "../src/planning.js";

describe("deterministic planning", () => {
  it("creates only evidence-linked read-only suggestions", () => {
    const discovery = { pages: 1, routes: ["https://app.example.test/dashboard"], titles: ["Dashboard"], headings: ["Overview"], controls: [], apiOperations: [], authenticationUsed: true };
    const evidence = buildDiscoveryEvidence("https://app.example.test", discovery);
    const plan = suggestDeterministicTests("https://app.example.test", "qa", ["app.example.test"], discovery, evidence);
    expect(plan.cases).toHaveLength(1); expect(plan.cases[0]).toMatchObject({ sideEffect: "read_only", source: "rule" });
    expect(evidence.evidence.map((x) => x.evidenceId)).toContain(plan.cases[0]!.evidenceRefs[0]);
  });
});
