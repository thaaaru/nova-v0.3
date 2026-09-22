import { describe, expect, it } from "vitest";
import { formatProbeReport, redactProbeText } from "../src/app-probe.js";

describe("governed Playwright app probe", () => {
  it("redacts secrets and renders a human-readable read-only inventory", () => {
    expect(redactProbeText("authorization=Bearer secret-value password=hunter2")).not.toContain("secret-value");
    const report = formatProbeReport({ version: 1, target: "https://app.example.test/", generatedAt: "2026-09-22T00:00:00.000Z", readOnly: true, pages: [{ route: "/dashboard", status: 200, title: "Dashboard", headings: ["Overview"], forms: [], controls: 4, links: ["/tables"], consoleErrors: [], failedRequests: [], blockedMutationAttempts: ["POST https://app.example.test/orders blocked"] }] });
    expect(report).toContain("Read-only guarantee");
    expect(report).toContain("Blocked mutation");
    expect(report).toContain("/dashboard");
  });
});
