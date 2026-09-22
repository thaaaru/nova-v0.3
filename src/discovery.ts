import { chromium, type BrowserContextOptions } from "playwright";

export type DiscoverySummary = { pages: number; routes: string[]; titles: string[]; headings: string[]; authenticationUsed: boolean };

/** Read-only same-origin crawl. It navigates and observes only; it never fills, clicks, or submits. */
export async function discoverApplication(options: { target: string; storageState?: unknown; maxPages?: number; onProgress?: (message: string) => void }): Promise<DiscoverySummary> {
  const target = new URL(options.target); const browser = await chromium.launch({ headless: true });
  const routes: string[] = [], titles: string[] = [], headings: string[] = [], queue = [target.href], seen = new Set<string>();
  try {
    const context = await browser.newContext(options.storageState ? { storageState: options.storageState as BrowserContextOptions["storageState"] } : {});
    while (queue.length && routes.length < (options.maxPages ?? 20)) {
      const url = queue.shift()!; if (seen.has(url)) continue; seen.add(url);
      const page = await context.newPage(); options.onProgress?.(`Discovering ${url}`);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        const current = new URL(page.url()); if (current.origin !== target.origin) continue;
        routes.push(current.href); titles.push((await page.title()).slice(0, 160));
        headings.push(...await page.locator("h1,h2").allTextContents().then((items) => items.map((x) => x.trim()).filter(Boolean).slice(0, 12)));
        for (const href of await page.locator("a[href]").evaluateAll((links) => links.slice(0, 100).map((link) => (link as HTMLAnchorElement).href))) {
          try { const candidate = new URL(href); if (candidate.origin === target.origin && !seen.has(candidate.href)) queue.push(candidate.href); } catch { /* ignore malformed links */ }
        }
      } catch { options.onProgress?.(`Skipped unavailable route ${url}`); } finally { await page.close(); }
    }
    await context.close();
    return { pages: routes.length, routes, titles, headings: [...new Set(headings)].slice(0, 40), authenticationUsed: Boolean(options.storageState) };
  } finally { await browser.close(); }
}
