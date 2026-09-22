---
name: playwright-app-probe
description: Probe a running web application with Playwright to build an inventory of its pages, forms, buttons, API calls and auth surfaces, derive the testable use cases from that inventory, and generate a prioritised test-case matrix plus runnable Playwright spec files. Use this skill whenever the user wants to "explore", "crawl", "probe", "map", "discover", "reverse-engineer" or "understand what to test" in a web app, wants test cases or a test plan derived from a live URL, asks to "generate Playwright tests", "write e2e tests for this site", "find testable flows", or wants a QA/test coverage baseline for an app they did not write. Trigger even if the user only gives a URL and says "test this" — the probe → use cases → test cases pipeline is the right response.
---

# Playwright App Probe

Turn a URL into (1) an application inventory, (2) a list of testable use cases, and (3) Playwright test cases — with as much of the work done by scripts and as little guesswork as possible.

Why this pipeline exists: writing tests for an app you didn't build fails in a predictable way — the tester guesses at flows, picks fragile selectors, and misses whole areas (background API calls, error states, role-gated pages). Probing first with a real browser gives you ground truth: what actually exists, what selectors are stable, what the app calls behind the scenes. Use cases are then *derived* from evidence instead of imagined, and tests are grounded in real selectors.

## Pipeline

```
URL (+ optional credentials)
   │
   ▼  scripts/probe.mjs
inventory.json + inventory.md + screenshots/
   │
   ▼  you, guided by references/usecase-taxonomy.md
usecases.json           (testable use cases, prioritised)
   │
   ▼  scripts/generate_tests.mjs
tests/*.spec.ts + test-matrix.md
   │
   ▼  npx playwright test (optional smoke run)
```

## Step 0 — Preconditions and scope

Before touching the app, establish:

- **Authorisation.** Only probe applications the user owns or is explicitly permitted to test. The probe submits no forms and sends no mutating requests by default (see `--allow-mutations`), but it does crawl every reachable link and record traffic. If the target is clearly third-party production infrastructure with no stated permission, ask before running.
- **Environment.** Prefer staging/local. If only production is available, run with `--max-pages` small and never enable mutations.
- **Credentials.** Ask whether there is a login. If yes, get either (a) a storage-state file, or (b) username/password + login URL, or (c) run the probe unauthenticated first and let it detect the login surface.
- **Scope.** Default is same-origin, depth 3, 60 pages. Confirm any exclusions (logout links, delete buttons, admin areas).

State the assumptions you make in one line and proceed; don't block on minor unknowns.

## Step 1 — Set up Playwright (once per environment)

```bash
mkdir -p app-probe && cd app-probe
npm init -y >/dev/null
npm install --save-dev playwright @playwright/test
npx playwright install chromium   # add --with-deps on bare Linux
cp <skill-path>/scripts/*.mjs .
```

If `npx playwright install` fails for network reasons, tell the user the exact command to run locally; the generated specs are still useful without a local run.

## Step 2 — Probe the application

```bash
node probe.mjs --url https://app.example.com \
  --out ./probe-output \
  --max-pages 60 --max-depth 3 \
  [--storage-state auth.json] \
  [--login-url /login --user USER --pass PASS --user-sel '#email' --pass-sel '#password' --submit-sel 'button[type=submit]'] \
  [--exclude 'logout,signout,delete'] \
  [--allow-mutations]        # off by default: non-GET requests are aborted, except login/auth/graphql/search calls the page itself fires
```

What the probe records per page (see `references/inventory-schema.md` for the full schema):

- URL, title, status, H1/H2 text, breadcrumb-ish nav labels
- **Forms**: action, method, every field (tag, type, name, id, label, placeholder, required, pattern, options), submit controls
- **Interactive elements**: buttons, links, role-based controls (tab, menuitem, checkbox, switch, dialog triggers) with the best available stable locator (`data-testid` → `aria-label`/role+name → id → text)
- **Network**: every XHR/fetch triggered while loading the page (method, path, status, content-type) — this exposes the API surface behind the UI
- **State hooks**: cookies (names only), localStorage/sessionStorage keys, detected auth/session tokens (names only, never values)
- **Signals**: console errors, failed requests, redirects, presence of login/logout/register/reset-password/search/pagination/upload/download/modal patterns
- Screenshot per page

Read `probe-output/inventory.md` first (human summary), then dip into `inventory.json` for detail. If the probe found fewer than ~5 pages on an app that obviously has more, the app is probably a client-side SPA whose routes aren't in `<a href>` — re-run with `--spa` (clicks nav-like elements and captures `history.pushState` routes) or supply `--seed-urls` from the user.

## Step 3 — Derive testable use cases

This is the judgement step; a script can't do it well. Open `references/usecase-taxonomy.md` and walk the inventory against each category. For every use case, the standard you're writing to is: a QA engineer with no other context could execute it and know whether it passed.

Write `usecases.json` in this shape (full schema in `references/inventory-schema.md`):

```json
{
  "app": "https://app.example.com",
  "usecases": [
    {
      "id": "UC-AUTH-01",
      "title": "User logs in with valid credentials",
      "category": "authentication",
      "priority": "P0",
      "actor": "registered user",
      "preconditions": ["A valid account exists"],
      "entry": "/login",
      "evidence": ["form#login on /login", "POST /api/auth/login observed"],
      "main_flow": ["Open /login", "Fill email", "Fill password", "Click Sign in"],
      "expected": ["Redirect to /dashboard", "Session cookie 'sid' set", "Header shows user name"],
      "variants": [
        {"id": "UC-AUTH-01-N1", "type": "negative", "title": "Wrong password shows error, no session"},
        {"id": "UC-AUTH-01-B1", "type": "boundary", "title": "Empty submit shows required-field validation"}
      ],
      "locators": {"email": "#email", "password": "#password", "submit": "button[type=submit]"}
    }
  ]
}
```

Rules that keep this useful rather than padded:

- **Every use case cites evidence from the inventory.** No evidence → it's a hypothesis; mark it `"status": "unverified"` and put it in a separate "candidate" list rather than the main matrix.
- **Priority is about blast radius, not effort.** P0 = revenue/auth/data-loss paths; P1 = core CRUD and navigation; P2 = secondary features; P3 = cosmetic/edge.
- **Variants are where the value is.** Each main flow should carry at least one negative and one boundary variant where the inventory shows validation (`required`, `pattern`, `maxlength`, select options, numeric inputs).
- **Include non-functional cases the inventory exposes**: unauthenticated access to authenticated routes (from redirect signals), role separation (if multiple roles were probed), API responses without UI (from network log), console errors on load, broken links (from failed requests).
- **Aim for coverage, not volume.** 15–40 use cases is typical for a mid-size app. If you're past 60, you're listing UI elements, not use cases — merge.

Present the use cases to the user as a table (ID, title, category, priority, evidence count) before generating tests, unless they asked for the whole pipeline in one go.

## Step 4 — Generate test cases and specs

```bash
node generate_tests.mjs --usecases usecases.json --inventory probe-output/inventory.json \
  --out ./tests --base-url https://app.example.com [--auth-fixture]
```

This produces:

- `tests/<category>/<uc-id>.spec.ts` — one `test.describe` per use case, one `test` per main flow and per variant. Steps become `test.step()` blocks with real locators from `usecases.json`; expectations become `expect(...)` assertions where they're mechanically derivable (URL, visible text, cookie presence, response status) and `// TODO(verify)` comments where they aren't.
- `tests/fixtures.ts` — authenticated `page` fixture using storage state, if `--auth-fixture`.
- `playwright.config.ts` — baseURL, retries, trace-on-retry, HTML reporter.
- `test-matrix.md` — the traceability matrix: use case → test IDs → priority → status. This is what a test lead actually reviews.

After generation, **open two or three of the generated specs and fix them by hand** — the generator is deliberately conservative and leaves TODOs where an assertion needs domain knowledge (e.g. "the order total equals the sum of line items"). Resolve TODOs using the inventory and screenshots; a spec with unresolved TODOs should be marked `test.fixme()` so it doesn't produce false greens. See `references/test-patterns.md` for the patterns to apply (locator priority, waiting, auth reuse, data isolation, flakiness rules).

## Step 5 — Smoke run (when the environment allows)

```bash
npx playwright test --project=chromium --reporter=list
```

Report: total / passed / failed / fixme, and for each failure whether it's (a) an app defect, (b) a wrong assumption in the use case, or (c) a test bug. Update `usecases.json` and the matrix accordingly — the artefacts should stay in sync, they're the deliverable.

## Deliverables checklist

Hand back, in this order:

1. `test-matrix.md` — the summary a stakeholder reads
2. `usecases.json` — the source of truth
3. `tests/` — runnable specs + config + fixtures
4. `probe-output/inventory.md` + `inventory.json` + `screenshots/` — evidence
5. A short note: assumptions made, areas not covered and why, next steps (e.g. "role X not probed — need credentials")

## Common pitfalls

- **Probing the marketing site instead of the app.** If the URL lands on a landing page, look for `/app`, `/dashboard`, `/login` in the inventory's links and re-seed.
- **SPA with zero discovered routes.** Use `--spa`, or ask for a route list / sitemap.
- **Cookie banners and modals blocking the crawl.** Pass `--dismiss 'button:has-text("Accept")'` (comma-separated selectors clicked once per page).
- **Rate limits / WAF.** Lower `--concurrency` to 1 and add `--delay-ms 500`.
- **Treating every button as a use case.** A use case is a goal an actor has, not a control. Group controls under the goal.
- **Assertion-free tests.** If a generated test only navigates and clicks, it's a smoke test at best — say so in the matrix rather than counting it as coverage.

## Reference files

- `references/usecase-taxonomy.md` — categories, what evidence in the inventory points to each, and the standard variants to attach. Read this in Step 3.
- `references/inventory-schema.md` — `inventory.json` and `usecases.json` field definitions. Read when you need a field's exact meaning.
- `references/test-patterns.md` — Playwright conventions the generated tests follow and that hand-fixes should keep to. Read in Step 4.
- `assets/example-usecases.json` — a worked example for a small task-manager app; useful as a shape reference.
