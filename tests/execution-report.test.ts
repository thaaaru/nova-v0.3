import { describe, expect, it } from "vitest";
import { formatExecutionReport } from "../src/execution.js";

describe("execution report", () => {
  it("renders check-level evidence", () => {
    const report = formatExecutionReport({ generatedAt: "2026-09-22T00:00:00.000Z", planId: "plan-1", planHash: "hash", readOnly: true, passed: 0, failed: 1, results: [{ id: "TC-001", name: "Load dashboard", target: "https://app.example.test/dashboard", durationMs: 1200, status: "failed", checks: [{ name: "HTTP response", status: "passed", detail: "Received 200." }, { name: "Curated content assertion 1", status: "failed", detail: "Expected one of: Open Tables." }], consoleErrors: [], failedRequests: [], blockedMutationAttempts: [] }] });
    expect(report).toContain("Curated content assertion 1");
    expect(report).toContain("1200 ms");
    expect(report).toContain("No mutating request was permitted");
  });
});
