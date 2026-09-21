import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { ApprovalSubmissionSchema, stableHash, type ApprovalSubmission, type TestPlan } from "./domain.js";

export type ApprovalResult = { submission: ApprovalSubmission; approvalId: string; approvedPlanHash?: string };
export type ApprovalServer = { url: string; close(): Promise<void>; wait(): Promise<ApprovalResult> };
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** A one-shot review surface. It binds only to loopback and never trusts browser state. */
export function startApprovalServer(plan: TestPlan, context: { applicationName?: string; target: string; environment: string; scope: string[] }): ApprovalServer {
  const reviewToken = randomBytes(24).toString("base64url"), csrf = randomBytes(24).toString("base64url"), planHash = stableHash(plan);
  let settled = false, settle!: (result: ApprovalResult) => void;
  const done = new Promise<ApprovalResult>((resolve) => { settle = resolve; });
  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const origin = request.headers.origin;
    const expectedOrigin = `http://127.0.0.1:${(server.address() as AddressInfo | null)?.port}`;
    const send = (code: number, body: string, type = "text/html") => response.writeHead(code, { "content-type": `${type}; charset=utf-8`, "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'", "cache-control": "no-store" }).end(body);
    if (!equal(url.searchParams.get("token") ?? "", reviewToken)) return send(403, "Review token is invalid or expired.", "text/plain");
    if (request.method === "GET" && url.pathname === "/") return send(200, page(plan, planHash, csrf, context, reviewToken));
    if (request.method !== "POST" || url.pathname !== "/decision" || origin !== expectedOrigin || settled) return send(403, "Invalid review request.", "text/plain");
    let body = ""; for await (const chunk of request) body += chunk;
    try {
      const parsed = ApprovalSubmissionSchema.parse(JSON.parse(body));
      if (!equal(parsed.planId, plan.id) || !equal(parsed.planHash, planHash) || !equal(request.headers["x-nova-csrf"] as string ?? "", csrf)) throw new Error("Stale or invalid decision.");
      const known = new Set(plan.cases.map((test) => test.id));
      if ([...parsed.selectedTestCaseIds, ...parsed.excludedTestCaseIds].some((id) => !known.has(id))) throw new Error("Unknown test case.");
      if (parsed.decision === "approved" && parsed.selectedTestCaseIds.length === 0) throw new Error("Select at least one test.");
      settled = true; const result = { submission: parsed, approvalId: `APV-${randomBytes(5).toString("hex")}`, approvedPlanHash: parsed.decision === "approved" ? stableHash({ plan, selected: parsed.selectedTestCaseIds }) : undefined };
      settle(result); send(200, "<p>Decision recorded. You may return to Nova.</p>"); setTimeout(() => server.close(), 50).unref();
    } catch (error) { send(400, error instanceof Error ? error.message : "Invalid decision.", "text/plain"); }
  });
  server.listen(0, "127.0.0.1");
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}/?token=${reviewToken}`, wait: () => done, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

function page(plan: TestPlan, planHash: string, csrf: string, context: { applicationName?: string; target: string; environment: string; scope: string[] }, token: string): string {
  const safe = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]!);
  const rows = plan.cases.map((test) => `<tr><td><input aria-label="Select ${safe(test.id)}" type="checkbox" value="${safe(test.id)}" checked></td><td>${safe(test.id)}</td><td>${safe(test.area)}</td><td>${safe(test.journey)}</td><td>${safe(test.persona)}</td><td>${safe(test.name)}</td><td>${safe(test.sideEffect)}</td><td>${safe(test.source)}</td></tr>`).join("");
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nova plan review</title><style>:root{color-scheme:dark;--bg:#0f172a;--card:#1b2336;--text:#f8fafc;--muted:#94a3b8;--accent:#22c55e;--danger:#ef4444}*{box-sizing:border-box}body{max-width:1100px;margin:auto;padding:32px;font:16px/1.5 system-ui;background:var(--bg);color:var(--text)}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #475569;text-align:left}button{padding:10px 16px;margin:8px 8px 0 0;font:inherit;border:0;border-radius:4px}button.primary{background:var(--accent);color:#0f172a}button.danger{background:var(--danger);color:#fff}small{color:var(--muted)}:focus-visible{outline:3px solid #fff;outline-offset:3px}</style><main><h1>Nova approval review</h1><p>${safe(context.applicationName ?? "Application")} · ${safe(context.environment)} · ${safe(context.target)}</p><p><small>Plan ${safe(plan.id)} · hash ${planHash} · scope ${safe(context.scope.join(", "))}</small></p><table><thead><tr><th>Select</th><th>ID</th><th>Area</th><th>Journey</th><th>Persona</th><th>Test</th><th>Effect</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table><label for="comment">Comment</label><textarea id="comment" rows="4" style="display:block;width:100%"></textarea><p><button class="primary" onclick="submit('approved')">Approve selected</button><button onclick="submit('changes_requested')">Request changes</button><button class="danger" onclick="submit('rejected')">Reject plan</button></p></main><script>async function submit(decision){const ids=[...document.querySelectorAll('input:checked')].map(x=>x.value);const r=await fetch('/decision?token=${token}',{method:'POST',headers:{'content-type':'application/json','x-nova-csrf':'${csrf}'},body:JSON.stringify({planId:'${plan.id}',planHash:'${planHash}',decision,selectedTestCaseIds:decision==='approved'?ids:[],excludedTestCaseIds:decision==='approved'?${JSON.stringify(plan.cases.map(c => c.id))}.filter(x=>!ids.includes(x)):[],comment:document.querySelector('#comment').value})});document.body.innerHTML=await r.text()}</script>`;
}
