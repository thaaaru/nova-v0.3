import { chromium, type BrowserContextOptions } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TestPlan } from "./domain.js";

export type ExecutionCheck = { name: string; status: "passed" | "failed"; detail: string };
export type ExecutionResult = { id: string; name: string; target?: string; durationMs: number; status: "passed" | "failed"; checks: ExecutionCheck[]; consoleErrors: string[]; failedRequests: string[]; blockedMutationAttempts: string[] };
export type ExecutionRun = { generatedAt: string; planId: string; planHash: string; readOnly: true; results: ExecutionResult[]; passed: number; failed: number; artifactPath: string };

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const redact = (value: string) => value.replace(/(?:authorization|bearer|token|password|secret|cookie)\s*[:=]?\s*[^\s"']+/gi, "[REDACTED]").replace(/\b\+?\d[\d ()-]{7,}\d\b/g, "[REDACTED_PHONE]").slice(0, 500);
const escapeHtml = (value: string) => value.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!);

export function formatExecutionReport(run: Omit<ExecutionRun, "artifactPath">): string {
  const rows = run.results.map((result) => `<tr><td>${escapeHtml(result.id)}</td><td>${escapeHtml(result.name)}</td><td class="${result.status === "passed" ? "pass" : "fail"}">${result.status.toUpperCase()}</td><td>${result.durationMs} ms</td><td>${result.checks.filter((check) => check.status === "passed").length}/${result.checks.length}</td></tr>`).join("");
  const detail = run.results.map((result) => `<section><h3>${escapeHtml(result.id)} — ${escapeHtml(result.name)}</h3><p><code>${escapeHtml(result.target ?? "invalid target")}</code></p><ul>${result.checks.map((check) => `<li class="${check.status === "passed" ? "pass" : "fail"}">${escapeHtml(check.name)}: ${escapeHtml(check.detail)}</li>`).join("")}</ul>${result.consoleErrors.length ? `<h4>Console errors</h4><ul>${result.consoleErrors.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : ""}${result.failedRequests.length ? `<h4>Failed requests</h4><ul>${result.failedRequests.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : ""}${result.blockedMutationAttempts.length ? `<h4>Blocked mutation attempts</h4><ul>${result.blockedMutationAttempts.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : ""}</section>`).join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nova execution report</title><style>body{font:16px/1.5 system-ui;max-width:1100px;margin:40px auto;color:#172554;padding:0 20px}header,section{border:1px solid #dbe3ef;border-radius:10px;padding:20px;margin:16px 0}.pass{color:#166534}.fail{color:#b91c1c;font-weight:700}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #dbe3ef}code{overflow-wrap:anywhere;background:#f1f5f9;padding:2px 5px}</style><header><p>Nova approved read-only execution</p><h1>Test execution report</h1><p>Plan ${escapeHtml(run.planId)} · ${escapeHtml(run.generatedAt)}</p></header><section><h2>Result</h2><p><strong>${run.passed}</strong> passed · <strong>${run.failed}</strong> failed · Every page was checked for response status, readiness, rendered content, browser errors, failed network requests, and mutation attempts. Curated routes include their configured visible-content assertions.</p><p>No mutating request was permitted.</p></section><section><h2>Test summary</h2><table><tr><th>ID</th><th>Test</th><th>Result</th><th>Duration</th><th>Checks</th></tr>${rows}</table></section><section><h2>Evidence and checks</h2>${detail}</section></html>`;
}

export async function executeApprovedReadOnly(plan: TestPlan, selected: string[], approvedPlanHash: string, storageState?: unknown, headed = false, assertionsByRoute: Readonly<Record<string, readonly (readonly string[])[]>> = {}): Promise<ExecutionRun> {
  const browser = await chromium.launch({ headless: !headed });
  const results: ExecutionResult[] = [];
  try {
    const context = await browser.newContext(storageState ? { storageState: storageState as BrowserContextOptions["storageState"] } : {});
    await context.route("**/*", (route) => safeMethods.has(route.request().method()) ? route.continue() : route.abort("blockedbyclient"));
    for (const test of plan.cases.filter((item) => selected.includes(item.id))) {
      if (test.sideEffect !== "read_only") throw new Error(`Refusing side-effecting case ${test.id} without preflight.`);
      const target = test.steps[0]?.replace(/^Navigate to\s+/, "");
      const startedAt = Date.now();
      const checks: ExecutionCheck[] = [], consoleErrors: string[] = [], failedRequests: string[] = [], blockedMutationAttempts: string[] = [];
      if (!target || !URL.canParse(target)) { results.push({ id: test.id, name: test.name, target, durationMs: Date.now() - startedAt, status: "failed", checks: [{ name: "Test target", status: "failed", detail: "The approved test did not contain a valid URL." }], consoleErrors, failedRequests, blockedMutationAttempts }); continue; }
      const page = await context.newPage();
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(redact(message.text())); });
      page.on("requestfailed", (request) => { const detail = redact(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`); if (safeMethods.has(request.method())) failedRequests.push(detail); else blockedMutationAttempts.push(detail); });
      try {
        const response = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
        checks.push({ name: "HTTP response", status: response && response.status() < 400 ? "passed" : "failed", detail: `Received ${response?.status() ?? "no response"}.` });
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).then(() => checks.push({ name: "Network settled", status: "passed", detail: "No in-flight network activity for 500 ms." })).catch(() => checks.push({ name: "Network settled", status: "failed", detail: "Network did not settle within 15 seconds." }));
        const readiness = await page.evaluate(async () => { await document.fonts?.ready; return { readyState: document.readyState, text: document.body?.innerText.trim().length ?? 0, visible: Boolean(document.body && getComputedStyle(document.body).visibility !== "hidden") }; });
        checks.push({ name: "Document readiness", status: readiness.readyState === "complete" ? "passed" : "failed", detail: `document.readyState is ${readiness.readyState}.` });
        checks.push({ name: "Rendered content", status: readiness.visible && readiness.text > 0 ? "passed" : "failed", detail: readiness.visible ? `${readiness.text} visible text characters.` : "Body is not visible." });
        const path = new URL(page.url()).pathname;
        for (const [index, phrases] of (assertionsByRoute[path] ?? []).entries()) {
          const visible = await Promise.all(phrases.map((phrase) => page.getByText(phrase, { exact: false }).first().isVisible().catch(() => false)));
          checks.push({ name: `Curated content assertion ${index + 1}`, status: visible.some(Boolean) ? "passed" : "failed", detail: visible.some(Boolean) ? `Visible: ${phrases.join(" or ")}.` : `Expected one of: ${phrases.join(" or ")}.` });
        }
      } catch (error) { checks.push({ name: "Browser navigation", status: "failed", detail: redact(error instanceof Error ? error.message : String(error)) }); }
      finally {
        checks.push({ name: "Console errors", status: consoleErrors.length ? "failed" : "passed", detail: consoleErrors.length ? `${consoleErrors.length} error(s) observed.` : "None observed." });
        checks.push({ name: "Failed network requests", status: failedRequests.length ? "failed" : "passed", detail: failedRequests.length ? `${failedRequests.length} failed request(s) observed.` : "None observed." });
        checks.push({ name: "Mutation protection", status: blockedMutationAttempts.length ? "failed" : "passed", detail: blockedMutationAttempts.length ? `${blockedMutationAttempts.length} mutation request(s) blocked.` : "No mutation attempt observed." });
        await page.close();
      }
      results.push({ id: test.id, name: test.name, target, durationMs: Date.now() - startedAt, status: checks.every((check) => check.status === "passed") ? "passed" : "failed", checks, consoleErrors, failedRequests, blockedMutationAttempts });
    }
    await context.close();
  } finally { await browser.close(); }
  const generatedAt = new Date().toISOString();
  const partial = { generatedAt, planId: plan.id, planHash: approvedPlanHash, readOnly: true as const, results, passed: results.filter((result) => result.status === "passed").length, failed: results.filter((result) => result.status === "failed").length };
  mkdirSync("artifacts/runs", { recursive: true });
  const basename = `run-${generatedAt.replace(/[:.]/g, "-")}`;
  const artifactPath = join("artifacts/runs", `${basename}.html`);
  writeFileSync(join("artifacts/runs", `${basename}.json`), JSON.stringify({ ...partial, artifactPath }, null, 2));
  writeFileSync(artifactPath, formatExecutionReport(partial));
  return { ...partial, artifactPath };
}
