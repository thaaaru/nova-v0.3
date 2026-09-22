import { chromium, type BrowserContextOptions } from "playwright";
import type { TestPlan } from "./domain.js";

export async function executeApprovedReadOnly(plan: TestPlan, selected: string[], storageState?: unknown): Promise<{ passed: number; failed: number }> {
  const browser = await chromium.launch({ headless: true }); let passed = 0, failed = 0;
  try {
    const context = await browser.newContext(storageState ? { storageState: storageState as BrowserContextOptions["storageState"] } : {});
    for (const test of plan.cases.filter((item) => selected.includes(item.id))) {
      if (test.sideEffect !== "read_only") throw new Error(`Refusing side-effecting case ${test.id} without preflight.`);
      const target = test.steps[0]?.replace(/^Navigate to\s+/, "");
      if (!target || !URL.canParse(target)) { failed += 1; continue; }
      const page = await context.newPage();
      try { const response = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 }); if (response && response.status() < 400) passed += 1; else failed += 1; } catch { failed += 1; } finally { await page.close(); }
    }
    await context.close(); return { passed, failed };
  } finally { await browser.close(); }
}
