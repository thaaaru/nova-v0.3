import { describe, expect, it } from "vitest";
import { assertAxloDashboardScope } from "../src/journeys/axlo-dashboard.js";
describe("Axlo dashboard journey scope", () => {
  it("allows only documented read-only routes and GET", () => {
    expect(() => assertAxloDashboardScope("/dashboard")).not.toThrow();
    expect(() => assertAxloDashboardScope("/orders", "GET")).toThrow(/scope/);
    expect(() => assertAxloDashboardScope("/dashboard", "POST")).toThrow(/mutating/);
  });
});
