import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  goto: vi.fn().mockResolvedValue(undefined), storageState: vi.fn().mockResolvedValue({ cookies: [] }),
  contextClose: vi.fn().mockResolvedValue(undefined), browserClose: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("playwright", () => ({ chromium: { launch: vi.fn().mockResolvedValue({ newContext: vi.fn().mockResolvedValue({ newPage: vi.fn().mockResolvedValue({ goto: mocks.goto }), storageState: mocks.storageState, close: mocks.contextClose }), close: mocks.browserClose }) } }));

import { createPlaywrightBrowserSignIn } from "../src/browser-auth.js";

describe("Playwright browser authentication", () => {
  it("waits for the operator, then returns storage state without inspecting credentials", async () => {
    const waitForCompletion = vi.fn().mockResolvedValue(undefined);
    const session = await createPlaywrightBrowserSignIn({ waitForCompletion })("https://app.example.test/login");
    expect(mocks.goto).toHaveBeenCalledWith("https://app.example.test/login", expect.objectContaining({ waitUntil: "domcontentloaded" }));
    expect(waitForCompletion).toHaveBeenCalledOnce();
    expect(await session.storageState()).toEqual({ cookies: [] });
    await session.close(); expect(mocks.contextClose).toHaveBeenCalledOnce(); expect(mocks.browserClose).toHaveBeenCalledOnce();
  });
});
