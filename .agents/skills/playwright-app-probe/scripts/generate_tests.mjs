#!/usr/bin/env node
/**
 * generate_tests.mjs — turn usecases.json into Playwright spec files,
 * a config, fixtures, and a traceability matrix.
 *
 * Usage:
 *   node generate_tests.mjs --usecases usecases.json [--inventory probe-output/inventory.json]
 *                           --out ./tests --base-url https://app.example.com [--auth-fixture]
 *                           [--storage-state probe-output/storage-state.json]
 *
 * The generator is conservative: it emits real locators and assertions where they
 * are mechanically derivable and `// TODO(verify)` + test.fixme() where they are not.
 * Hand-review is expected — see references/test-patterns.md.
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opts = { out: './tests', authFixture: false, storageState: 'probe-output/storage-state.json' };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], v = argv[i + 1];
  switch (a) {
    case '--usecases': opts.usecases = v; i++; break;
    case '--inventory': opts.inventory = v; i++; break;
    case '--out': opts.out = v; i++; break;
    case '--base-url': opts.baseUrl = v; i++; break;
    case '--storage-state': opts.storageState = v; i++; break;
    case '--auth-fixture': opts.authFixture = true; break;
    default: console.error(`Unknown arg ${a}`); process.exit(2);
  }
}
if (!opts.usecases) { console.error('--usecases required'); process.exit(2); }
const uc = JSON.parse(fs.readFileSync(opts.usecases, 'utf8'));
const inventory = opts.inventory && fs.existsSync(opts.inventory) ? JSON.parse(fs.readFileSync(opts.inventory, 'utf8')) : null;
const baseUrl = opts.baseUrl || uc.app || inventory?.meta?.origin || 'http://localhost:3000';
const outDir = path.resolve(opts.out);
fs.mkdirSync(outDir, { recursive: true });

// ---------- helpers ----------
const q = (s) => { const m = String(s).match(/^\$\{(\w+)\}$/); return m ? `(process.env.${m[1]} ?? '')` : JSON.stringify(String(s)); };
const ident = (s) => s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const locatorExpr = (loc) => {
  if (!loc) return null;
  if (typeof loc === 'string') {
    // allow shorthand "role:button/Sign in", "testid:foo", "text:Save", or a raw css
    const m = loc.match(/^(role|testid|text|css):(.+)$/);
    if (!m) return `page.locator(${q(loc)})`;
    const [, strat, rest] = m;
    if (strat === 'role') { const [role, name] = rest.split('/'); return name ? `page.getByRole(${q(role)}, { name: ${q(name)} })` : `page.getByRole(${q(role)})`; }
    if (strat === 'testid') return `page.getByTestId(${q(rest)})`;
    if (strat === 'text') return `page.getByText(${q(rest)})`;
    return `page.locator(${q(rest)})`;
  }
  switch (loc.strategy) {
    case 'testid': return `page.getByTestId(${q(loc.value)})`;
    case 'role': return loc.name ? `page.getByRole(${q(loc.value)}, { name: ${q(loc.name)} })` : `page.getByRole(${q(loc.value)})`;
    case 'text': return `page.getByText(${q(loc.value)})`;
    default: return `page.locator(${q(loc.value)})`;
  }
};

// Translate a natural-language step into code when it matches a known pattern; otherwise emit a TODO.
// Steps may also be objects: {action:'goto'|'fill'|'click'|'select'|'check'|'upload'|'expectUrl'|'expectVisible'|'expectText'|'expectCookie'|'expectResponse', target, value}
function stepToCode(step, locators, ctx) {
  const L = (key) => locatorExpr(locators?.[key]) || null;
  if (typeof step === 'object') {
    const t = step.target, tl = L(t) || (t ? locatorExpr(t) : null);
    switch (step.action) {
      case 'goto': return `await page.goto(${q(step.target)});`;
      case 'fill': return tl ? `await ${tl}.fill(${q(step.value ?? '')});` : todo(step);
      case 'click': return tl ? `await ${tl}.click();` : todo(step);
      case 'select': return tl ? `await ${tl}.selectOption(${q(step.value)});` : todo(step);
      case 'check': return tl ? `await ${tl}.check();` : todo(step);
      case 'upload': return tl ? `await ${tl}.setInputFiles(${q(step.value)});` : todo(step);
      case 'expectUrl': return `await expect(page).toHaveURL(${step.value?.startsWith('/') ? `/${escapeRe(step.value)}/` : q(step.value)});`;
      case 'expectVisible': return tl ? `await expect(${tl}).toBeVisible();` : `await expect(page.getByText(${q(step.value || step.target)})).toBeVisible();`;
      case 'expectHidden': return tl ? `await expect(${tl}).toBeHidden();` : todo(step);
      case 'expectText': return `await expect(page.getByText(${q(step.value)})).toBeVisible();`;
      case 'expectCookie': return `expect((await page.context().cookies()).some(c => c.name === ${q(step.value)})).toBe(true);`;
      case 'expectNoCookie': return `expect((await page.context().cookies()).some(c => c.name === ${q(step.value)})).toBe(false);`;
      case 'expectResponse': return `await page.waitForResponse(r => r.url().includes(${q(step.target)}) && r.status() === ${Number(step.value) || 200});`;
      case 'expectStatus': ctx.needsResponse = true; return `expect(response?.status()).toBe(${Number(step.value)});`;
      default: return todo(step);
    }
  }
  const s = String(step).trim();
  let m;
  if ((m = s.match(/^(?:open|go to|navigate to|visit)\s+(\S+)/i))) return `await page.goto(${q(m[1])});`;
  if ((m = s.match(/^(?:fill|enter|type)\s+(?:in\s+)?["']?([^"']+?)["']?\s+(?:with|=|as|:)\s+["']?(.+?)["']?$/i))) { const l = L(ident(m[1]).toLowerCase()) || L(m[1]); return l ? `await ${l}.fill(${q(m[2])});` : todo(s); }
  if ((m = s.match(/^(?:fill|enter|type)\s+["']?([^"']+?)["']?$/i))) { const l = L(ident(m[1]).toLowerCase()) || L(m[1]); return l ? `await ${l}.fill(${q('TODO_VALUE')}); // TODO(verify): value for ${m[1]}` : todo(s); }
  if ((m = s.match(/^(?:click|press|tap|submit)\s+(?:on\s+|the\s+)?["']?([^"']+?)["']?(?:\s+button|\s+link)?$/i))) { const l = L(ident(m[1]).toLowerCase()) || L(m[1]); return l ? `await ${l}.click();` : `await page.getByRole('button', { name: ${q(m[1])} }).or(page.getByRole('link', { name: ${q(m[1])} })).first().click(); // TODO(verify): locator inferred from step text`; }
  if ((m = s.match(/^(?:select|choose)\s+["']?(.+?)["']?\s+(?:in|from)\s+["']?(.+?)["']?$/i))) { const l = L(ident(m[2]).toLowerCase()) || L(m[2]); return l ? `await ${l}.selectOption({ label: ${q(m[1])} });` : todo(s); }
  if ((m = s.match(/^(?:check|tick|enable)\s+["']?(.+?)["']?$/i))) { const l = L(ident(m[1]).toLowerCase()) || L(m[1]); return l ? `await ${l}.check();` : todo(s); }
  return todo(s);
}
function expectationToCode(exp, locators) {
  if (typeof exp === 'object') return stepToCode(exp, locators, {});
  const s = String(exp).trim();
  let m;
  if ((m = s.match(/^(?:redirect(?:ed|s)?\s+to|url\s+(?:is|becomes|contains))\s+(\S+)/i))) return `await expect(page).toHaveURL(${m[1].startsWith('/') ? `/${escapeRe(m[1])}/` : q(m[1])});`;
  if ((m = s.match(/(?:cookie|session)\s+["']([^"']+)["']\s+(?:is\s+)?(?:set|present)/i))) return `expect((await page.context().cookies()).some(c => c.name === ${q(m[1])})).toBe(true);`;
  if ((m = s.match(/cookie\s+["']([^"']+)["'].*\b(httponly|secure|samesite)\b/i))) return `{ const c = (await page.context().cookies()).find(c => c.name === ${q(m[1])}); expect(c).toBeTruthy(); ${/httponly/i.test(s) ? 'expect(c?.httpOnly).toBe(true); ' : ''}${/\bsecure\b/i.test(s) ? 'expect(c?.secure).toBe(true); ' : ''}${/samesite/i.test(s) ? "expect(['Lax','Strict']).toContain(c?.sameSite); " : ''}}`;
  if ((m = s.match(/no\s+(?:cookie|session)\s+["']([^"']+)["']/i))) return `expect((await page.context().cookies()).some(c => c.name === ${q(m[1])})).toBe(false);`;
  if ((m = s.match(/(?:shows?|displays?|see|contains?|visible)\s*:?\s*["'](.+?)["']/i))) return `await expect(page.getByText(${q(m[1])})).toBeVisible();`;
  if ((m = s.match(/^title\s+(?:is|contains)\s+["'](.+?)["']/i))) return `await expect(page).toHaveTitle(/${escapeRe(m[1])}/);`;
  if ((m = s.match(/^(?:status|response)\s+(\d{3})/i))) return `// TODO(verify): assert response status ${m[1]} on the relevant request`;
  return `// TODO(verify): ${s}`;
}
const todo = (s) => `// TODO(verify): ${typeof s === 'string' ? s : JSON.stringify(s)}`;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/');

// ---------- emit ----------
const matrixRows = [];
let specCount = 0, testCount = 0, fixmeCount = 0;
const byCategory = {};
for (const u of uc.usecases || []) (byCategory[u.category || 'general'] ||= []).push(u);

for (const [cat, list] of Object.entries(byCategory)) {
  const dir = path.join(outDir, ident(cat).toLowerCase());
  fs.mkdirSync(dir, { recursive: true });
  for (const u of list) {
    const needsAuth = u.auth !== false && (u.actor && !/anonymous|guest|unauthenticated|visitor/i.test(u.actor)) && opts.authFixture;
    const imp = needsAuth ? `import { test, expect } from '../fixtures';` : `import { test, expect } from '@playwright/test';`;
    const lines = [`// Generated from ${u.id} — ${u.title}`, `// Evidence: ${(u.evidence || []).join('; ') || 'none (unverified)'}`, `// Priority: ${u.priority || 'P2'} · Actor: ${u.actor || 'unspecified'}`, imp, ''];
    if (u.status === 'unverified') lines.push(`test.describe.fixme(${q(`${u.id} ${u.title}`)}, () => {`);
    else lines.push(`test.describe(${q(`${u.id} ${u.title}`)}, () => {`);
    if (u.preconditions?.length) lines.push(`  // Preconditions: ${u.preconditions.join('; ')}`);
    if (u.entry) { lines.push(`  test.beforeEach(async ({ page }) => {`, `    await page.goto(${q(u.entry)});`, `  });`, ''); }

    const emitTest = (id, title, steps, expected, type) => {
      const ctx = {};
      const body = [];
      for (const s of steps || []) body.push(`    await test.step(${q(typeof s === 'string' ? s : s.action + ' ' + (s.target || ''))}, async () => {`, `      ${stepToCode(s, u.locators, ctx)}`, `    });`);
      const asserts = (expected || []).map(e => `    ${expectationToCode(e, u.locators)}`);
      const allCode = [...body, ...asserts].join('\n');
      const hasTodo = /TODO\(verify\)/.test(allCode);
      const hasAssert = /expect\(/.test(allCode);
      const tag = `@${(u.priority || 'P2').toLowerCase()} @${type}`;
      if (hasTodo || !hasAssert) fixmeCount++;
      testCount++;
      lines.push(`  test${hasTodo || !hasAssert ? '.fixme' : ''}(${q(`${id} ${title} ${tag}`)}, async ({ page }) => {`);
      if (!hasAssert) lines.push(`    // TODO(verify): no assertion could be derived — add one before un-fixme-ing`);
      lines.push(allCode || '    // TODO(verify): no steps provided', `  });`, '');
      matrixRows.push({ uc: u.id, test: id, title, type, priority: u.priority || 'P2', file: path.relative(outDir, path.join(dir, `${ident(u.id).toLowerCase()}.spec.ts`)), status: hasTodo || !hasAssert ? 'fixme (needs review)' : 'ready' });
    };
    emitTest(u.id, u.title, u.main_flow, u.expected, 'positive');
    for (const v of u.variants || []) emitTest(v.id, v.title, v.steps || u.main_flow, v.expected || [], v.type || 'variant');
    lines.push(`});`, '');
    fs.writeFileSync(path.join(dir, `${ident(u.id).toLowerCase()}.spec.ts`), lines.join('\n'));
    specCount++;
  }
}

// config + fixtures
fs.writeFileSync(path.join(outDir, '..', 'playwright.config.ts'), `import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './${path.basename(outDir)}',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL || ${q(baseUrl)},
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
`);
if (opts.authFixture) {
  fs.writeFileSync(path.join(outDir, 'fixtures.ts'), `import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
// Authenticated fixture: reuses a storage state captured by probe.mjs --login-url (or by a global setup you write).
const STATE = process.env.STORAGE_STATE || ${q(path.relative(path.join(outDir, '..'), path.resolve(opts.storageState)))};
export const test = base.extend({
  storageState: async ({}, use) => { await use(fs.existsSync(STATE) ? STATE : undefined); },
});
export { expect };
`);
}

// matrix
const prio = { P0: 0, P1: 1, P2: 2, P3: 3 };
matrixRows.sort((a, b) => (prio[a.priority] ?? 9) - (prio[b.priority] ?? 9) || a.uc.localeCompare(b.uc));
const md = [`# Test traceability matrix — ${baseUrl}`, '', `Generated ${new Date().toISOString()} · ${uc.usecases?.length || 0} use cases · ${specCount} spec files · ${testCount} tests · ${fixmeCount} marked fixme pending review`, '',
  `| Use case | Test ID | Title | Type | Priority | Spec | Status |`, `|---|---|---|---|---|---|---|`];
for (const r of matrixRows) md.push(`| ${r.uc} | ${r.test} | ${r.title} | ${r.type} | ${r.priority} | ${r.file} | ${r.status} |`);
md.push('', '## Coverage by category', '', `| Category | Use cases | Tests |`, `|---|---|---|`);
for (const [cat, list] of Object.entries(byCategory)) md.push(`| ${cat} | ${list.length} | ${list.reduce((n, u) => n + 1 + (u.variants?.length || 0), 0)} |`);
md.push('', '## Notes', '', '- "fixme" tests contain `TODO(verify)` markers or lack a derivable assertion. Resolve them by hand using the inventory and screenshots, then remove `.fixme`.',
  '- Tags: `@p0..@p3` for priority, `@positive|@negative|@boundary|@security|@variant` for type. Run a subset with `npx playwright test --grep @p0`.');
fs.writeFileSync(path.join(outDir, '..', 'test-matrix.md'), md.join('\n'));
console.error(`[generate] ${specCount} specs, ${testCount} tests (${fixmeCount} fixme) → ${outDir}; matrix at ${path.join(outDir, '..', 'test-matrix.md')}`);
