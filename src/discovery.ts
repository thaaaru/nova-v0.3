import { chromium, type BrowserContextOptions } from "playwright";

export type DiscoveryControl = { kind: "link" | "button" | "form"; label: string; route?: string };
export type ApiOperation = { method: string; path: string; status?: number };
export type DiscoverySummary = { pages: number; routes: string[]; titles: string[]; headings: string[]; controls: DiscoveryControl[]; apiOperations: ApiOperation[]; authenticationUsed: boolean };

/** Read-only same-origin crawl. It navigates and observes only; it never fills, clicks, or submits. */
export async function discoverApplication(options: { target: string; storageState?: unknown; seedRoutes?: string[]; maxPages?: number; onProgress?: (message: string) => void }): Promise<DiscoverySummary> {
  const target = new URL(options.target); const browser = await chromium.launch({ headless: true });
  const routes: string[] = [], titles: string[] = [], headings: string[] = [], controls: DiscoveryControl[] = [], apiOperations: ApiOperation[] = [], queue = [target.href, ...(options.seedRoutes ?? []).map((route) => new URL(route, target).href)], seen = new Set<string>();
  try {
    const context = await browser.newContext(options.storageState ? { storageState: options.storageState as BrowserContextOptions["storageState"] } : {});
    while (queue.length && routes.length < (options.maxPages ?? 20)) {
      const url = queue.shift()!; if (seen.has(url)) continue; seen.add(url);
      const page = await context.newPage(); options.onProgress?.(`Discovering ${url}`);
      try {
        page.on("response", (response) => { const request = response.request(); try { const operation = new URL(request.url()); if (operation.origin === target.origin && ["xhr", "fetch"].includes(request.resourceType())) apiOperations.push({ method: request.method(), path: `${operation.pathname}${operation.search}`, status: response.status() }); } catch { /* ignore malformed request URLs */ } });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        const current = new URL(page.url()); if (current.origin !== target.origin) continue;
        routes.push(current.href); titles.push((await page.title()).slice(0, 160));
        headings.push(...await page.locator("h1,h2").allTextContents().then((items) => items.map((x) => x.trim()).filter(Boolean).slice(0, 12)));
        controls.push(...await page.locator("a[href],button,[role=button],form").evaluateAll((items) => items.slice(0, 100).map((item) => ({ kind: item.tagName === "A" ? "link" : item.tagName === "FORM" ? "form" : "button", label: (item.textContent ?? item.getAttribute("aria-label") ?? item.getAttribute("name") ?? "").trim().slice(0, 160), route: item instanceof HTMLAnchorElement ? item.href : undefined })).filter((item) => item.label || item.route)) as DiscoveryControl[]);
        for (const href of await page.locator("a[href]").evaluateAll((links) => links.slice(0, 100).map((link) => (link as HTMLAnchorElement).href))) {
          try { const candidate = new URL(href); if (candidate.origin === target.origin && !seen.has(candidate.href)) queue.push(candidate.href); } catch { /* ignore malformed links */ }
        }
      } catch { options.onProgress?.(`Skipped unavailable route ${url}`); } finally { await page.close(); }
    }
    await context.close();
    return { pages: routes.length, routes, titles, headings: [...new Set(headings)].slice(0, 40), controls: controls.filter((item, index, all) => all.findIndex((other) => other.kind === item.kind && other.label === item.label && other.route === item.route) === index), apiOperations: apiOperations.filter((item, index, all) => all.findIndex((other) => other.method === item.method && other.path === item.path && other.status === item.status) === index), authenticationUsed: Boolean(options.storageState) };
  } finally { await browser.close(); }
}
