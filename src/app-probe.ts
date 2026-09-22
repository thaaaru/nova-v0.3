import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContextOptions } from "playwright";

export type ProbePage = {
  route: string;
  status?: number;
  title: string;
  headings: string[];
  forms: Array<{ method: string; fields: number }>;
  controls: number;
  links: string[];
  consoleErrors: string[];
  failedRequests: string[];
  blockedMutationAttempts: string[];
};

export type ApplicationProbeInventory = {
  version: 1;
  target: string;
  generatedAt: string;
  readOnly: true;
  pages: ProbePage[];
  artifactPath: string;
};

const secretLike = /(?:authorization|bearer|token|password|secret|cookie)\s*[:=]?\s*[^\s"']+/gi;
export function redactProbeText(value: string): string {
  return value.replace(secretLike, "[REDACTED]").replace(/\b\+?\d[\d ()-]{7,}\d\b/g, "[REDACTED_PHONE]").slice(0, 500);
}

function html(value: string): string { return value.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!); }

export function formatProbeReport(inventory: Omit<ApplicationProbeInventory, "artifactPath">): string {
  const anomalies = inventory.pages.filter((page) => (page.status ?? 0) >= 400 || page.consoleErrors.length || page.failedRequests.length || page.blockedMutationAttempts.length);
  const rows = inventory.pages.map((page) => `<tr><td>${html(page.route)}</td><td class="${(page.status ?? 0) < 400 ? "pass" : "fail"}">${html(String(page.status ?? "unavailable"))}</td><td>${html(page.title || "—")}</td><td>${page.forms.length}</td><td>${page.controls}</td><td>${page.links.length}</td><td>${page.consoleErrors.length + page.failedRequests.length}</td></tr>`).join("");
  const details = anomalies.length ? anomalies.map((page) => `<li><strong>${html(page.route)}</strong>: ${[...(page.consoleErrors.map((item) => `Console: ${item}`)), ...(page.failedRequests.map((item) => `Network: ${item}`)), ...(page.blockedMutationAttempts.map((item) => `Blocked mutation: ${item}`))].map(html).join("; ") || `HTTP ${page.status}`}</li>`).join("") : "<li>No availability, console, network, or blocked-mutation anomalies observed.</li>";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nova application probe</title><style>body{font:16px/1.5 system-ui;max-width:1100px;margin:40px auto;color:#172554;padding:0 20px}header,section{border:1px solid #dbe3ef;border-radius:10px;padding:22px;margin:16px 0}.pass{color:#166534;font-weight:700}.fail{color:#b91c1c;font-weight:700}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #dbe3ef;text-align:left;padding:9px;vertical-align:top}code{background:#f1f5f9;padding:2px 5px}</style><header><p>Nova governed discovery</p><h1>Application probe inventory</h1><p>${html(inventory.target)} · ${html(inventory.generatedAt)}</p></header><section><h2>Read-only guarantee</h2><p>All non-GET, non-HEAD, and non-OPTIONS requests initiated after authentication were blocked and recorded. No forms or controls were activated.</p></section><section><h2>Summary</h2><p><strong>${inventory.pages.length}</strong> pages inspected · <strong>${anomalies.length}</strong> pages with anomalies</p></section><section><h2>Pages and test surfaces</h2><table><tr><th>Route</th><th>HTTP</th><th>Title</th><th>Forms</th><th>Controls</th><th>Links</th><th>Errors</th></tr>${rows}</table></section><section><h2>Findings</h2><ul>${details}</ul></section></html>`;
}

/**
 * Nova's governed adaptation of the installed playwright-app-probe skill.
 * It observes only already-approved same-origin routes and blocks mutations at
 * the browser boundary; saved authentication is supplied by Nova's secure layer.
 */
export async function probeApplication(options: { target: string; routes: string[]; storageState?: unknown; artifactsDir?: string; onProgress?: (message: string) => void }): Promise<ApplicationProbeInventory> {
  const base = new URL(options.target);
  const routes = [...new Set(options.routes.map((route) => new URL(route, base).href).filter((route) => new URL(route).origin === base.origin))];
  const browser = await chromium.launch({ headless: true });
  const pages: ProbePage[] = [];
  try {
    const context = await browser.newContext(options.storageState ? { storageState: options.storageState as BrowserContextOptions["storageState"] } : {});
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (["GET", "HEAD", "OPTIONS"].includes(request.method())) return route.continue();
      return route.abort("blockedbyclient");
    });
    for (const href of routes) {
      const page = await context.newPage();
      const consoleErrors: string[] = [], failedRequests: string[] = [], blockedMutationAttempts: string[] = [];
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(redactProbeText(message.text())); });
      page.on("requestfailed", (request) => {
        const text = `${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`;
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) blockedMutationAttempts.push(redactProbeText(text)); else failedRequests.push(redactProbeText(text));
      });
      options.onProgress?.(`Probing ${href}`);
      try {
        const response = await page.goto(href, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
        await page.locator("body").waitFor({ state: "visible", timeout: 10_000 });
        await page.evaluate(async () => { await document.fonts?.ready; });
        const details = await page.evaluate(() => ({
          title: document.title,
          headings: Array.from(document.querySelectorAll("h1,h2")).map((element) => element.textContent?.trim() ?? "").filter(Boolean).slice(0, 12),
          forms: Array.from(document.forms).slice(0, 30).map((form) => ({ method: (form.method || "GET").toUpperCase(), fields: form.querySelectorAll("input:not([type=hidden]),select,textarea").length })),
          controls: document.querySelectorAll("button,[role=button],[role=tab],[role=menuitem],input,select,textarea").length,
          links: Array.from(document.querySelectorAll("a[href]")).map((link) => (link as HTMLAnchorElement).href).filter((link) => { try { return new URL(link).origin === location.origin; } catch { return false; } }).slice(0, 200),
        }));
        pages.push({ route: new URL(page.url()).pathname, status: response?.status(), title: redactProbeText(details.title), headings: details.headings.map(redactProbeText), forms: details.forms, controls: details.controls, links: details.links.map((link) => new URL(link).pathname), consoleErrors, failedRequests, blockedMutationAttempts });
      } catch (error) {
        pages.push({ route: new URL(href).pathname, title: "", headings: [], forms: [], controls: 0, links: [], consoleErrors, failedRequests: [...failedRequests, redactProbeText(error instanceof Error ? error.message : String(error))], blockedMutationAttempts });
      } finally { await page.close(); }
    }
    await context.close();
  } finally { await browser.close(); }
  const artifactsDir = options.artifactsDir ?? "artifacts/probes";
  mkdirSync(artifactsDir, { recursive: true });
  const baseName = `application-probe-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const generatedAt = new Date().toISOString();
  const artifactPath = join(artifactsDir, `${baseName}.html`);
  const inventory: ApplicationProbeInventory = { version: 1, target: base.href, generatedAt, readOnly: true, pages, artifactPath };
  writeFileSync(join(artifactsDir, `${baseName}.json`), JSON.stringify(inventory, null, 2));
  writeFileSync(artifactPath, formatProbeReport(inventory));
  return inventory;
}
