import { describe, expect, it } from "vitest";
import { isGitHubRemote } from "../src/update.js";

describe("nova update remote guard", () => {
  it("accepts GitHub HTTPS and SSH remotes only", () => {
    expect(isGitHubRemote("https://github.com/thaaaru/nova-v0.3.git")).toBe(true);
    expect(isGitHubRemote("git@github.com:thaaaru/nova-v0.3.git")).toBe(true);
    expect(isGitHubRemote("https://example.test/thaaaru/nova-v0.3.git")).toBe(false);
  });
});
