#!/usr/bin/env node
/**
 * probe.mjs — crawl a web application with Playwright and emit an inventory
 * of pages, forms, interactive elements, network calls and state hooks.
 *
 * Read-only by default: forms are never submitted, no mutating (non-GET)
 * navigations are triggered, unless --allow-mutations is passed.
 *
 * Usage:
 *   node probe.mjs --url https://app.example.com [options]
 *
 * Options:
 *   --out DIR                 output directory (default ./probe-output)
 *   --max-pages N             default 60
 *   --max-depth N             default 3
 *   --concurrency N           default 3
 *   --delay-ms N              delay between page visits per worker (default 0)
 *   --timeout-ms N            per-page navigation timeout (default 20000)
 *   --storage-state FILE      Playwright storage state (cookies/localStorage) for auth
 *   --login-url PATH          perform a login before crawling
 *   --user, --pass            credentials for --login-url
 *   --user-sel, --pass-sel, --submit-sel   selectors for the login form
 *   --seed-urls a,b,c         extra start URLs (paths or absolute)
 *   --exclude a,b,c           substrings; URLs containing any are skipped (default: logout,signout,sign-out,delete)
 *   --dismiss sel1,sel2       selectors clicked once per page if visible (cookie banners etc.)
 *   --spa                     also click nav-like elements to discover pushState routes
 *   --allow-mutations         permit non-GET requests initiated by page interactions
 *   --headed                  run headed
 *   --no-screenshots          skip screenshots
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

// ---------- args ----------
const argv = process.argv.slice(2);
const opts = {
  out: './probe-output', maxPages: 60, maxDepth: 3, concurrency: 3, delayMs: 0, timeoutMs: 20000,
  exclude: ['logout', 'signout', 'sign-out', 'delete'], dismiss: [], seedUrls: [],
  spa: false, allowMutations: false, headed: false, screenshots: true,
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], v = argv[i + 1];
  const take = () => { i++; return v; };
  switch (a) {
    case '--url': opts.url = take(); break;
    case '--out': opts.out = take(); break;
    case '--max-pages': opts.maxPages = +take(); break;
    case '--max-depth': opts.maxDepth = +take(); break;
    case '--concurrency': opts.concurrency = +take(); break;
    case '--delay-ms': opts.delayMs = +take(); break;
    case '--timeout-ms': opts.timeoutMs = +take(); break;
    case '--storage-state': opts.storageState = take(); break;
    case '--login-url': opts.loginUrl = take(); break;
    case '--user': opts.user = take(); break;
    case '--pass': opts.pass = take(); break;
    case '--user-sel': opts.userSel = take(); break;
    case '--pass-sel': opts.passSel = take(); break;
    case '--submit-sel': opts.submitSel = take(); break;
    case '--seed-urls': opts.seedUrls = take().split(',').map(s => s.trim()).filter(Boolean); break;
    case '--exclude': opts.exclude = take().split(',').map(s => s.trim()).filter(Boolean); break;
    case '--dismiss': opts.dismiss = take().split(',').map(s => s.trim()).filter(Boolean); break;
    case '--spa': opts.spa = true; break;
    case '--allow-mutations': opts.allowMutations = true; break;
    case '--headed': opts.headed = true; break;
    case '--no-screenshots': opts.screenshots = false; break;
    case '--help': case '-h': console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('*/')[0]); process.exit(0);
    default: console.error(`Unknown arg ${a}`); process.exit(2);
  }
}
if (!opts.url) { console.error('--url is required'); process.exit(2); }

const origin = new URL(opts.url).origin;
const outDir = path.resolve(opts.out);
const shotDir = path.join(outDir, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });

// ---------- helpers ----------
const normalize = (u) => {
  try {
    const url = new URL(u, origin);
    url.hash = '';
    // drop common tracking params
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/.test(k)) url.searchParams.delete(k);
    let s = url.toString();
    if (s.endsWith('/') && url.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch { return null; }
};
const inScope = (u) => {
  if (!u) return false;
  try {
    const url = new URL(u);
    if (url.origin !== origin) return false;
    if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|map|pdf|zip|woff2?|ttf|mp4|mp3)$/i.test(url.pathname)) return false;
    const low = u.toLowerCase();
    return !opts.exclude.some(x => low.includes(x.toLowerCase()));
  } catch { return false; }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const slug = (u) => (new URL(u).pathname.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'root').slice(0, 80);

// ---------- in-page extraction ----------
const EXTRACT = () => {
  const bestLocator = (el) => {
    const tid = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
    if (tid) return { strategy: 'testid', value: tid };
    const role = el.getAttribute('role') || ({ A: 'link', BUTTON: 'button', INPUT: el.type === 'submit' || el.type === 'button' ? 'button' : el.type === 'checkbox' ? 'checkbox' : el.type === 'radio' ? 'radio' : 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox' }[el.tagName] || null);
    const aria = el.getAttribute('aria-label');
    const txt = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (role && (aria || txt)) return { strategy: 'role', value: role, name: aria || txt };
    if (el.id && !/^[a-z]*[0-9]{3,}|^:r|^radix|^mui/i.test(el.id)) return { strategy: 'css', value: `#${CSS.escape(el.id)}` };
    if (el.name) return { strategy: 'css', value: `${el.tagName.toLowerCase()}[name="${el.name}"]` };
    if (txt) return { strategy: 'text', value: txt };
    return { strategy: 'css', value: el.tagName.toLowerCase() };
  };
  const labelFor = (el) => {
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return l.innerText.trim(); }
    const p = el.closest('label'); if (p) return p.innerText.trim();
    const lb = el.getAttribute('aria-labelledby'); if (lb) { const t = document.getElementById(lb); if (t) return t.innerText.trim(); }
    return el.getAttribute('aria-label') || '';
  };
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const text = (sel) => [...document.querySelectorAll(sel)].map(e => e.innerText.trim()).filter(Boolean).slice(0, 20);

  const forms = [...document.querySelectorAll('form')].map((f, i) => ({
    index: i,
    id: f.id || null, name: f.getAttribute('name') || null,
    action: f.getAttribute('action') || null, method: (f.getAttribute('method') || 'GET').toUpperCase(),
    locator: f.id ? { strategy: 'css', value: `#${CSS.escape(f.id)}` } : { strategy: 'css', value: `form:nth-of-type(${i + 1})` },
    fields: [...f.querySelectorAll('input,select,textarea')].filter(e => e.type !== 'hidden').map(e => ({
      tag: e.tagName.toLowerCase(), type: e.type || null, name: e.name || null, id: e.id || null,
      label: labelFor(e), placeholder: e.getAttribute('placeholder') || null,
      required: e.required || e.getAttribute('aria-required') === 'true',
      pattern: e.getAttribute('pattern') || null, minlength: e.getAttribute('minlength'), maxlength: e.getAttribute('maxlength'),
      min: e.getAttribute('min'), max: e.getAttribute('max'), autocomplete: e.getAttribute('autocomplete') || null,
      options: e.tagName === 'SELECT' ? [...e.options].map(o => o.text.trim()).slice(0, 30) : undefined,
      locator: bestLocator(e),
    })),
    submits: [...f.querySelectorAll('button:not([type=button]),input[type=submit]')].map(b => ({ text: (b.innerText || b.value || '').trim(), locator: bestLocator(b) })),
    hasFileUpload: !!f.querySelector('input[type=file]'),
    hasPassword: !!f.querySelector('input[type=password]'),
  }));

  const controls = [...document.querySelectorAll('button,[role=button],[role=tab],[role=menuitem],[role=switch],[role=checkbox],input[type=checkbox],input[type=radio],select,[aria-haspopup],[data-testid]')]
    .filter(visible).filter(e => !e.closest('form')).slice(0, 150).map(e => ({
      tag: e.tagName.toLowerCase(), role: e.getAttribute('role') || null, text: (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 60),
      locator: bestLocator(e), opensDialog: e.getAttribute('aria-haspopup') === 'dialog' || /modal|dialog/i.test(e.getAttribute('data-bs-toggle') || e.getAttribute('data-target') || ''),
    }));

  const links = [...document.querySelectorAll('a[href]')].map(a => ({ href: a.href, text: a.innerText.trim().slice(0, 60), rel: a.rel || null })).filter(l => /^https?:/.test(l.href));

  const signals = {
    login: !!document.querySelector('input[type=password]') || /\b(log ?in|sign ?in)\b/i.test(document.body.innerText.slice(0, 5000)),
    logout: [...document.querySelectorAll('a,button')].some(e => /\b(log ?out|sign ?out)\b/i.test(e.innerText)),
    register: [...document.querySelectorAll('a,button')].some(e => /\b(sign ?up|register|create account)\b/i.test(e.innerText)),
    resetPassword: [...document.querySelectorAll('a,button')].some(e => /\b(forgot|reset).{0,15}password\b/i.test(e.innerText)),
    search: !!document.querySelector('input[type=search],[role=search],input[placeholder*="earch" i]'),
    pagination: !!document.querySelector('[aria-label*="pagination" i],.pagination,nav[aria-label*="page" i],[rel=next]'),
    upload: !!document.querySelector('input[type=file]'),
    download: [...document.querySelectorAll('a[download],a[href$=".csv"],a[href$=".pdf"],a[href$=".xlsx"]')].length > 0,
    table: document.querySelectorAll('table,[role=grid],[role=table]').length,
    modalTriggers: controls.filter(c => c.opensDialog).length,
    iframes: [...document.querySelectorAll('iframe')].map(f => f.src).filter(Boolean).slice(0, 10),
    hasCaptcha: !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],.g-recaptcha,.h-captcha'),
    hasChart: !!document.querySelector('canvas,svg.recharts-surface,.highcharts-container,.chartjs'),
    lang: document.documentElement.lang || null,
  };

  return {
    title: document.title,
    h1: text('h1'), h2: text('h2'),
    nav: [...document.querySelectorAll('nav a, [role=navigation] a, header a')].map(a => a.innerText.trim()).filter(Boolean).slice(0, 40),
    forms, controls, links, signals,
    storageKeys: { local: Object.keys(localStorage).slice(0, 50), session: Object.keys(sessionStorage).slice(0, 50) },
    spaRoutes: window.__probeRoutes || [],
  };
};

// ---------- main ----------
const browser = await chromium.launch({ headless: !opts.headed });
const ctx = await browser.newContext({ storageState: opts.storageState, ignoreHTTPSErrors: true, viewport: { width: 1366, height: 900 } });
await ctx.addInitScript(() => {
  window.__probeRoutes = [];
  const push = history.pushState.bind(history);
  history.pushState = function (s, t, u) { if (u) window.__probeRoutes.push(String(u)); return push(s, t, u); };
});

if (!opts.allowMutations) {
  await ctx.route('**/*', (route) => {
    const m = route.request().method();
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && !route.request().url().includes(new URL(opts.loginUrl || '/__none__', origin).pathname) && !/auth|login|session|token|graphql|search|query/i.test(route.request().url())) {
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
}

// optional login
if (opts.loginUrl && opts.user && opts.pass) {
  const p = await ctx.newPage();
  await p.goto(new URL(opts.loginUrl, origin).toString(), { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
  await p.fill(opts.userSel || 'input[type=email],input[name*=user i],input[name*=email i]', opts.user);
  await p.fill(opts.passSel || 'input[type=password]', opts.pass);
  await Promise.all([p.waitForLoadState('networkidle', { timeout: opts.timeoutMs }).catch(() => {}), p.click(opts.submitSel || 'button[type=submit],input[type=submit]')]);
  await ctx.storageState({ path: path.join(outDir, 'storage-state.json') });
  console.error(`[probe] logged in; storage state saved to ${path.join(outDir, 'storage-state.json')}`);
  await p.close();
}

const queue = [{ url: normalize(opts.url), depth: 0 }, ...opts.seedUrls.map(u => ({ url: normalize(u), depth: 0 }))].filter(q => inScope(q.url));
const seen = new Set(queue.map(q => q.url));
const pages = [];
const globalApi = new Map(); // key: METHOD path -> {count, statuses, pages}
const brokenLinks = [];

async function visit(item) {
  const page = await ctx.newPage();
  const rec = { url: item.url, depth: item.depth, status: null, finalUrl: null, redirected: false, network: [], consoleErrors: [], failedRequests: [], error: null };
  page.on('console', m => { if (m.type() === 'error') rec.consoleErrors.push(m.text().slice(0, 300)); });
  page.on('requestfailed', r => rec.failedRequests.push({ url: r.url(), method: r.method(), reason: r.failure()?.errorText }));
  page.on('response', async r => {
    const req = r.request();
    const rt = req.resourceType();
    if (rt !== 'xhr' && rt !== 'fetch') return;
    let u; try { u = new URL(r.url()); } catch { return; }
    const entry = { method: req.method(), url: u.origin === origin ? u.pathname + u.search : r.url(), status: r.status(), contentType: (r.headers()['content-type'] || '').split(';')[0] };
    rec.network.push(entry);
    const key = `${entry.method} ${u.origin === origin ? u.pathname.replace(/\/\d+(?=\/|$)/g, '/{id}').replace(/\/[0-9a-f-]{20,}(?=\/|$)/gi, '/{id}') : r.url()}`;
    const g = globalApi.get(key) || { method: entry.method, path: key.slice(entry.method.length + 1), count: 0, statuses: new Set(), pages: new Set(), contentType: entry.contentType };
    g.count++; g.statuses.add(r.status()); g.pages.add(item.url); globalApi.set(key, g);
  });
  try {
    const resp = await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
    rec.status = resp?.status() ?? null;
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    for (const sel of opts.dismiss) { const l = page.locator(sel).first(); if (await l.isVisible().catch(() => false)) await l.click({ timeout: 2000 }).catch(() => {}); }
    rec.finalUrl = normalize(page.url());
    rec.redirected = rec.finalUrl !== item.url;

    if (opts.spa) {
      // click nav-like elements that are not links to surface pushState routes, then return
      const navs = page.locator('nav [role=button], nav button, [role=navigation] button, aside button, [role=menuitem]');
      const n = Math.min(await navs.count(), 25);
      for (let i = 0; i < n; i++) {
        await navs.nth(i).click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(300);
        const u = normalize(page.url());
        if (u !== rec.finalUrl && inScope(u)) await page.goBack({ timeout: 3000 }).catch(() => {});
      }
    }

    const data = await page.evaluate(EXTRACT);
    Object.assign(rec, data);
    if (opts.screenshots) {
      rec.screenshot = `screenshots/${slug(rec.finalUrl)}.png`;
      await page.screenshot({ path: path.join(outDir, rec.screenshot), fullPage: true, timeout: 10000 }).catch(() => { rec.screenshot = null; });
    }
    // enqueue
    const next = [...data.links.map(l => l.href), ...data.spaRoutes];
    for (const raw of next) {
      const u = normalize(raw);
      if (!inScope(u) || seen.has(u)) continue;
      if (item.depth + 1 > opts.maxDepth || seen.size >= opts.maxPages) continue;
      seen.add(u); queue.push({ url: u, depth: item.depth + 1 });
    }
    if (rec.status && rec.status >= 400) brokenLinks.push({ url: item.url, status: rec.status });
  } catch (e) {
    rec.error = String(e.message || e).slice(0, 300);
  } finally {
    await page.close();
  }
  pages.push(rec);
  console.error(`[probe] ${pages.length}/${seen.size} ${rec.status ?? 'ERR'} ${rec.url}${rec.redirected ? ' -> ' + rec.finalUrl : ''}`);
  if (opts.delayMs) await sleep(opts.delayMs);
}

let active = 0;
async function worker() {
  while (pages.length + active < opts.maxPages) {
    const item = queue.shift();
    if (!item) {
      if (active === 0) break;           // nothing queued and nobody working → done
      await sleep(200); continue;        // another worker may enqueue more
    }
    active++;
    try { await visit(item); } finally { active--; }
  }
}
await Promise.all(Array.from({ length: opts.concurrency }, worker));
const finalState = await ctx.storageState().catch(() => ({ cookies: [] }));
await browser.close();

// ---------- aggregate ----------
const api = [...globalApi.values()].map(a => ({ ...a, statuses: [...a.statuses], pages: [...a.pages] })).sort((a, b) => b.count - a.count);
const cookies = [...new Set((finalState.cookies || []).map(c => c.name))];
const cookieFlags = (finalState.cookies || []).map(c => ({ name: c.name, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite }));
const authRedirects = pages.filter(p => p.redirected && /login|signin|auth/i.test(p.finalUrl || ''));
const inventory = {
  meta: { target: opts.url, origin, generatedAt: new Date().toISOString(), options: { ...opts, pass: opts.pass ? '***' : undefined }, pagesVisited: pages.length, urlsDiscovered: seen.size },
  summary: {
    pages: pages.length,
    forms: pages.reduce((n, p) => n + (p.forms?.length || 0), 0),
    loginPages: pages.filter(p => p.forms?.some(f => f.hasPassword)).map(p => p.finalUrl),
    authGatedRoutes: authRedirects.map(p => p.url),
    apiEndpoints: api.length,
    pagesWithConsoleErrors: pages.filter(p => p.consoleErrors.length).length,
    brokenLinks,
    features: {
      register: pages.some(p => p.signals?.register), resetPassword: pages.some(p => p.signals?.resetPassword), search: pages.some(p => p.signals?.search),
      pagination: pages.some(p => p.signals?.pagination), upload: pages.some(p => p.signals?.upload), download: pages.some(p => p.signals?.download),
      tables: pages.reduce((n, p) => n + (p.signals?.table || 0), 0), modals: pages.reduce((n, p) => n + (p.signals?.modalTriggers || 0), 0),
      captcha: pages.some(p => p.signals?.hasCaptcha), charts: pages.some(p => p.signals?.hasChart), iframes: [...new Set(pages.flatMap(p => p.signals?.iframes || []))],
    },
    storageKeys: { local: [...new Set(pages.flatMap(p => p.storageKeys?.local || []))], session: [...new Set(pages.flatMap(p => p.storageKeys?.session || []))], cookies, cookieFlags },
  },
  api,
  pages: pages.sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url)),
};
fs.writeFileSync(path.join(outDir, 'inventory.json'), JSON.stringify(inventory, null, 2));

// ---------- markdown summary ----------
const md = [];
md.push(`# Application inventory — ${origin}`, '', `Generated ${inventory.meta.generatedAt} · ${pages.length} pages visited · ${seen.size} URLs discovered · read-only=${!opts.allowMutations}`, '');
md.push('## Summary', '', `| Metric | Value |`, `|---|---|`);
for (const [k, v] of Object.entries(inventory.summary)) md.push(`| ${k} | ${typeof v === 'object' ? '`' + JSON.stringify(v).slice(0, 200) + '`' : v} |`);
md.push('', '## Pages', '', `| # | URL | Status | Title | Forms | Controls | XHR | Console errors | Notes |`, `|---|---|---|---|---|---|---|---|---|`);
inventory.pages.forEach((p, i) => md.push(`| ${i + 1} | ${p.url} | ${p.status ?? 'ERR'} | ${(p.title || '').replace(/\|/g, '/').slice(0, 50)} | ${p.forms?.length || 0} | ${p.controls?.length || 0} | ${p.network.length} | ${p.consoleErrors.length} | ${[p.redirected ? '→ ' + p.finalUrl : '', p.error ? 'ERR: ' + p.error : '', p.signals?.login ? 'login' : '', p.signals?.pagination ? 'pagination' : '', p.signals?.upload ? 'upload' : ''].filter(Boolean).join('; ')} |`));
md.push('', '## Forms', '');
for (const p of inventory.pages) for (const f of p.forms || []) {
  md.push(`### ${p.url} — form ${f.id ? '#' + f.id : '#' + f.index} (${f.method} ${f.action || '(same page)'})`, '', `| Field | Type | Label/placeholder | Required | Constraints | Locator |`, `|---|---|---|---|---|---|`);
  for (const x of f.fields) md.push(`| ${x.name || x.id || '-'} | ${x.tag}/${x.type} | ${x.label || x.placeholder || ''} | ${x.required ? 'yes' : ''} | ${[x.pattern && 'pattern=' + x.pattern, x.minlength && 'min=' + x.minlength, x.maxlength && 'max=' + x.maxlength, x.min && 'min=' + x.min, x.max && 'max=' + x.max, x.options && 'options=' + x.options.length].filter(Boolean).join(' ')} | \`${x.locator.strategy}:${x.locator.value}${x.locator.name ? '/' + x.locator.name : ''}\` |`);
  md.push(`Submit: ${f.submits.map(s => '"' + s.text + '"').join(', ') || '(none found)'}`, '');
}
md.push('## API surface (XHR/fetch observed)', '', `| Method | Path | Calls | Statuses | Type | Seen on |`, `|---|---|---|---|---|---|`);
for (const a of api) md.push(`| ${a.method} | ${a.path} | ${a.count} | ${a.statuses.join(',')} | ${a.contentType} | ${a.pages.length} page(s) |`);
md.push('', '## Signals for use-case derivation', '');
md.push(`- Login pages: ${inventory.summary.loginPages.join(', ') || 'none detected'}`);
md.push(`- Auth-gated routes (redirected to login): ${inventory.summary.authGatedRoutes.join(', ') || 'none detected'}`);
md.push(`- Feature flags: ${Object.entries(inventory.summary.features).filter(([, v]) => v && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}${typeof v === 'number' ? '=' + v : ''}`).join(', ')}`);
md.push(`- Cookies: ${cookies.join(', ') || '(none captured — pass --storage-state or --login-url)'}`);
md.push(`- localStorage keys: ${inventory.summary.storageKeys.local.join(', ') || 'none'}`);
if (inventory.summary.pagesWithConsoleErrors) { md.push('', '### Console errors', ''); for (const p of inventory.pages.filter(p => p.consoleErrors.length)) md.push(`- ${p.url}: ${p.consoleErrors.slice(0, 3).join(' | ')}`); }
if (brokenLinks.length) { md.push('', '### Broken links', ''); for (const b of brokenLinks) md.push(`- ${b.status} ${b.url}`); }
fs.writeFileSync(path.join(outDir, 'inventory.md'), md.join('\n'));
console.error(`[probe] done. ${path.join(outDir, 'inventory.md')}`);
