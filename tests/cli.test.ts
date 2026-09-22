import { describe, expect, it } from "vitest";

describe("pnpm argument compatibility", () => {
  it("removes only pnpm's separator before Commander parses child command options", async () => {
    const { normalizePnpmArgv } = await import("../src/cli-argv.js");
    expect(normalizePnpmArgv(["node", "nova", "--", "test", "https://app.example.test", "--require-auth"]))
      .toEqual(["node", "nova", "test", "https://app.example.test", "--require-auth"]);
  });
});
