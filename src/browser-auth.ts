import { chromium } from "playwright";
import type { BrowserSignIn } from "./auth.js";

export type BrowserAuthenticationOptions = {
  /** The presentation layer supplies this acknowledgement; credentials remain entirely in the browser. */
  waitForCompletion: (message: string) => Promise<void>;
};

/**
 * Opens a headed browser at the approved target. Nova never reads form values,
 * types credentials, or sends them to an LLM. The operator signs in directly
 * and explicitly confirms completion before the encrypted storage state is
 * captured.
 */
export function createPlaywrightBrowserSignIn(options: BrowserAuthenticationOptions): BrowserSignIn {
  return async (target) => {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await options.waitForCompletion("Complete sign-in in the browser, then confirm in Nova to continue.");
      return {
        storageState: () => context.storageState(),
        close: async () => { await context.close(); await browser.close(); },
      };
    } catch (error) {
      await context.close(); await browser.close(); throw error;
    }
  };
}

/** A bounded, read-only entry probe; it neither submits forms nor follows user actions. */
export async function probeAuthenticationRequired(target: string): Promise<boolean> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const response = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const passwordField = await page.locator('input[type="password"]').count();
    const loginPath = /\/(?:login|signin|sign-in|auth)(?:\/|$|[?#])/i.test(new URL(page.url()).pathname);
    const protectedStatus = response?.status() === 401 || response?.status() === 403;
    await context.close();
    return protectedStatus || passwordField > 0 || loginPath;
  } finally { await browser.close(); }
}
