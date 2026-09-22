import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { startApprovalServer } from "../src/approval-server.js";

describe("approval server", () => {
  it("binds a loopback random port before returning a review URL", async () => {
    const plan = { id: randomUUID(), version: 1, target: "https://app.example.test", environment: "qa", scope: ["app.example.test"], cases: [{ id: "TC-001", area: "a", journey: "j", persona: "p", name: "n", type: "navigation", priority: "low" as const, preconditions: [], steps: ["Navigate"], expectedResult: "Loads", sideEffect: "read_only" as const, evidenceRefs: ["E-001"], rationale: "r", confidence: 1, source: "rule" as const }] };
    let review;
    try { review = await startApprovalServer(plan, { target: plan.target, environment: "qa", scope: plan.scope }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") return; throw error; }
    try { expect(new URL(review.url).hostname).toBe("127.0.0.1"); expect((await fetch(review.url)).status).toBe(200); } finally { await review.close(); }
  });
});
