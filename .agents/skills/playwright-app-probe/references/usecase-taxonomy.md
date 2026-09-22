# Use-case taxonomy: from inventory evidence to testable use cases

Work through each category. For each, the table says which inventory fields are the evidence, what the main-flow use case looks like, and which variants to attach by default. Skip a category when the inventory has no evidence for it — write "not observed" in the deliverable note instead of inventing.

ID convention: `UC-<CAT>-<nn>` for main flows; variants append `-N<n>` (negative), `-B<n>` (boundary), `-S<n>` (security), `-A<n>` (accessibility/UX).

## 1. Authentication (`AUTH`)

| Evidence in inventory | Use case | Default variants |
|---|---|---|
| `summary.loginPages` non-empty; a form with `hasPassword` | Login with valid credentials → lands on post-login page, session cookie/token set | N: wrong password; N: unknown user; B: empty submit → required-field messages; S: password field has `type=password` and `autocomplete` not `off` in a way that breaks managers |
| `signals.register` | Register new account → confirmation state | N: duplicate email; B: password policy edges (`minlength`/`pattern` from field constraints); N: mismatched confirm password |
| `signals.resetPassword` | Request password reset → generic success message | S: same message for known/unknown email (no user enumeration) |
| `signals.logout` | Logout → session cleared, gated route redirects | S: back-button after logout does not show gated content |
| `summary.authGatedRoutes` | Unauthenticated access to gated route → redirect to login | S: deep-link returns to original route after login |
| cookies named like `sid`, `session`, `jwt`, `token` | Session persists across reload | S: cookie flags (`HttpOnly`, `Secure`, `SameSite`) — assert via `context.cookies()` |

## 2. Authorisation / roles (`AUTHZ`)

Only when you probed with ≥2 identities or the inventory shows role-named routes (`/admin`, `/manager`).

| Evidence | Use case | Variants |
|---|---|---|
| Routes visible in one identity's crawl but redirecting/404 in another | Role X can access feature; role Y cannot | S: direct URL access as lower role; S: API endpoint from `api[]` called as lower role returns 401/403 |
| Controls (e.g. "Delete", "Approve") present only for some roles | Privileged action visible only to permitted role | S: action hidden but API still callable — flag as candidate (needs an API test, not just UI) |

## 3. Navigation & information architecture (`NAV`)

| Evidence | Use case | Variants |
|---|---|---|
| `pages[].nav`, links between pages | Primary navigation reaches every top-level section | N: every nav link returns <400 (`summary.brokenLinks` empty) |
| `redirected` pages | Legacy/redirect URLs land on the right page | — |
| Depth ≥ 2 pages with breadcrumbs/H1 | Deep page shows correct heading/breadcrumb for context | — |
| `status` 404 page reachable | Unknown route shows friendly 404, not blank | — |

## 4. CRUD / core business flows (`CRUD`, or a domain name like `ORDER`, `TASK`)

This is where most of the value is. The evidence is a form + an API call.

| Evidence | Use case | Variants |
|---|---|---|
| Form with `method=POST`/JS submit + `POST /api/<resource>` in `api[]` | Create <resource> with valid data → appears in list / detail | N: each `required` field empty; B: `maxlength`+1; B: `min`/`max` boundaries; B: each `select` option; N: invalid `pattern` |
| Page listing items (`signals.table` > 0) + `GET /api/<resource>` | List shows items; search/filter/sort/pagination behave | B: empty state; B: last page; N: search with no matches |
| Detail route pattern `/<resource>/{id}` in `api[]` | View <resource> detail | N: non-existent id → 404 UI |
| `PUT`/`PATCH /api/<resource>/{id}` | Edit <resource> → changes persist after reload | N: concurrent/stale edit (candidate only) |
| `DELETE /api/<resource>/{id}` or a "Delete" control with `opensDialog` | Delete with confirmation → item gone | N: cancel in dialog leaves item; S: delete via URL/API without confirmation (candidate) |
| `signals.upload` | Upload file → shows in UI | B: max size; N: disallowed type; S: content-type mismatch |
| `signals.download` | Download/export → file received with expected name/type | — |

Name the category after the resource when clear (`UC-ORDER-01`), otherwise `CRUD`.

## 5. Search, filter, pagination (`SEARCH`)

| Evidence | Use case | Variants |
|---|---|---|
| `signals.search`, `GET …?q=` or `/search` in `api[]` | Search returns matching results | N: no results state; B: special chars; B: very long query; S: query reflected in page → check it is escaped (XSS smoke) |
| `signals.pagination`, `?page=` params | Pagination moves between pages, count consistent | B: page beyond last; B: page=0 / negative |
| Filter controls (selects/checkboxes outside forms) | Applying a filter narrows list | B: clear filters restores full list |

## 6. Forms & validation (`FORM`)

Use when a form is not part of a clearer CRUD flow (contact, feedback, settings).

| Evidence | Use case | Variants |
|---|---|---|
| Any form; field constraints | Submit valid form → success feedback | N: per-required-field; B: per-constraint; A: labels associated with inputs (from `label` field being non-empty) |

## 7. API surface without UI (`API`)

Endpoints in `api[]` that no form/control obviously drives are candidates for API-level tests via `request` fixture.

| Evidence | Use case |
|---|---|
| Endpoint with status 401/403 in unauthenticated crawl | Endpoint rejects unauthenticated calls |
| Endpoint returning 500 | Defect — record as finding, write a regression test |
| `GET /api/.../{id}` patterns | Response schema stable (status + content-type) |

## 8. Security smoke (`SEC`)

Not a pen test. These are cheap, deterministic checks the inventory makes possible; keep them in the matrix as `@security`.

| Evidence | Check |
|---|---|
| Any gated route | Direct access unauthenticated → redirect/401, never 200 with content |
| Session cookie names | `HttpOnly`, `Secure` (on https), `SameSite` set |
| Login form | Generic error on failure (no "user not found" vs "wrong password" split) |
| Search / any reflected input | `<script>` / `"'><img onerror>` payload is rendered escaped, no dialog fires |
| Response headers on the root page (capture with `page.request`) | `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `Strict-Transport-Security` present — report absence as finding, don't fail the build unless the user wants that |
| `signals.hasCaptcha` on auth forms | Note: tests need a bypass in staging |

## 9. Resilience & UX signals (`UX`)

| Evidence | Use case |
|---|---|
| `consoleErrors` on a page | Page loads without console errors (regression guard) |
| `failedRequests` | No failed sub-resource requests on load |
| `signals.modalTriggers` | Dialog opens, traps focus, closes on Escape/Cancel |
| `signals.hasChart` | Chart renders (canvas/svg present, non-zero size) — smoke only |
| Long lists / tables | Page usable at 375px viewport (mobile) — one test per key page |

## Prioritisation rules

- **P0**: login/logout, payment/checkout, anything that creates or deletes business records, auth gating.
- **P1**: primary CRUD read/list/edit, search, main navigation, role separation.
- **P2**: secondary forms, filters, exports, uploads, dialogs.
- **P3**: cosmetic, console-error guards, responsive smoke, header checks.

## Writing a good main flow

Bad: `["Go to page", "Do the thing", "Check it worked"]`
Good: `["Open /tasks", "Click 'New task'", "Fill title with 'Probe test task'", "Select 'High' in priority", "Click 'Save'"]` — each step names a control that exists in `locators`, and each expected item is observable: `"Redirect to /tasks"`, `"Shows 'Probe test task'"`, `"POST /api/tasks returns 201"`.

Structured steps are preferred when you want the generator to emit exact code:
`{"action":"fill","target":"title","value":"Probe test task"}` where `title` is a key in `locators`.

## Locator keys

`locators` maps short keys (`email`, `password`, `submit`, `title`, `newTask`) to either an inventory locator object (`{"strategy":"role","value":"button","name":"Save"}`) or shorthand (`"role:button/Save"`, `"testid:save-btn"`, `"text:Save"`, `"#save"`). Copy from the inventory rather than inventing — the whole point of probing first.
