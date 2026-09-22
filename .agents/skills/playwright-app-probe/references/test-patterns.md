# Playwright test patterns for generated and hand-fixed specs

These are the conventions the generator emits and that hand edits should preserve. Each one exists because its absence is a known source of flaky or vacuous tests.

## Locators

Priority order (same as the probe): `getByTestId` → `getByRole(role, { name })` → `getByLabel` (forms) → stable `#id` → `locator('tag[name=…]')` → `getByText`. Never use auto-generated ids, nth-child chains, or XPath. If the probe only found a `text:` locator for something important, ask the user to add `data-testid` — that's a legitimate deliverable recommendation.

`getByRole` with a name is a regex-or-substring match by default; use `{ exact: true }` when two controls share a prefix ("Save" vs "Save and close").

## Waiting

No `waitForTimeout`. Rely on auto-waiting locators and web-first assertions (`await expect(locator).toBeVisible()`). For navigation after a click use `await expect(page).toHaveURL(...)`, not `waitForNavigation`. For an API side-effect, use `page.waitForResponse(predicate)` set up *before* the click:

```ts
const resp = page.waitForResponse(r => r.url().includes('/api/tasks') && r.request().method() === 'POST');
await page.getByRole('button', { name: 'Save' }).click();
expect((await resp).status()).toBe(201);
```

## Assertions

Every test asserts something observable to the user *and* ideally something structural (URL, response status, cookie). A navigate-and-click test with no assertion is a smoke test — label it so in the matrix rather than counting it as coverage. Prefer specific assertions (`toHaveText`, `toHaveURL(/\/tasks\/\d+/)`) over `toBeVisible()` on a container.

Negative tests must assert the *absence* of the success outcome, not just the presence of an error: wrong-password test checks error message **and** that the session cookie is not set **and** URL is still `/login`.

## Auth

Reuse storage state. Log in once (probe `--login-url` or a `global-setup.ts`), save state, and use the `fixtures.ts` `test` export. Never log in via UI in every test; it's slow and couples every test to the login form. Tests that specifically exercise login import from `@playwright/test` directly and start unauthenticated.

For multi-role tests, keep one storage state per role (`state.admin.json`, `state.user.json`) and create a fixture per role.

## Data isolation

Create-flow tests should generate unique data (`Probe task ${Date.now()}`) and, where a delete endpoint exists, clean up in `test.afterEach` via `request` rather than the UI. If cleanup isn't possible, say so in the matrix — accumulating test data in a shared staging environment is a real cost.

## Structure

- One `describe` per use case, one `test` per flow/variant, `test.step` per user action — this is what makes the HTML report readable to a non-engineer.
- Tags in the title: `@p0`…`@p3` and `@positive|@negative|@boundary|@security`. Run `--grep @p0` for a fast gate.
- `test.fixme` for anything with `TODO(verify)`; `test.skip` only with a reason string.
- No conditionals on app state inside a test (`if (await x.isVisible())`). If state varies, the precondition is wrong — fix setup instead.

## Security-smoke conventions

- Cookie flags: `const c = (await page.context().cookies()).find(c => c.name === 'sid'); expect(c?.httpOnly).toBe(true);`
- Reflected input: fill `"'><img src=x onerror=alert(1)>` and assert `page.on('dialog')` never fires (attach the handler, fail if called) and the literal string appears escaped via `toContainText`.
- Headers: `const r = await page.request.get('/'); expect(r.headers()['x-frame-options'] ?? r.headers()['content-security-policy']).toBeTruthy();` — treat as *finding* not failure unless the user wants a hard gate.

## Flakiness triage after a smoke run

For each failure classify before touching anything:

1. **App defect** — reproducible manually → keep the test red, log it as a finding.
2. **Wrong assumption** — the use case expected something the app doesn't do → fix `usecases.json` first, then regenerate or hand-edit.
3. **Test bug** — locator/timing → fix the test; if a `waitForTimeout` "fixes" it, you've hidden a race, find the real signal.

Never bump retries to make it green.
