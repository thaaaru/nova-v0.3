# Schemas

## inventory.json (output of `probe.mjs`)

```
meta            { target, origin, generatedAt, options, pagesVisited, urlsDiscovered }
summary
  pages         number
  forms         number
  loginPages    string[]   URLs with a password field
  authGatedRoutes string[] URLs that redirected to a login-like URL
  apiEndpoints  number
  pagesWithConsoleErrors number
  brokenLinks   [{url,status}]
  features      { register, resetPassword, search, pagination, upload, download, tables, modals, captcha, charts, iframes[] }
  storageKeys   { local[], session[], cookies[], cookieFlags[{name,httpOnly,secure,sameSite}] }   names/flags only, never values
api[]           { method, path (ids normalised to {id}), count, statuses[], pages[], contentType }
pages[]
  url, depth, status, finalUrl, redirected, error, screenshot
  title, h1[], h2[], nav[]
  forms[]       { index, id, name, action, method, locator, fields[], submits[], hasFileUpload, hasPassword }
    fields[]    { tag, type, name, id, label, placeholder, required, pattern, minlength, maxlength, min, max, autocomplete, options[], locator }
    submits[]   { text, locator }
  controls[]    { tag, role, text, locator, opensDialog }   interactive elements outside forms
  links[]       { href, text, rel }
  signals       { login, logout, register, resetPassword, search, pagination, upload, download, table, modalTriggers, iframes[], hasCaptcha, hasChart, lang }
  network[]     { method, url, status, contentType }   XHR/fetch during this page's load
  consoleErrors[] string
  failedRequests[] { url, method, reason }
  storageKeys   { local[], session[] }
  spaRoutes[]   pushState targets observed (with --spa)
```

### locator object

```
{ strategy: "testid" | "role" | "css" | "text", value: string, name?: string }
```
Priority the probe applies: `data-testid`/`data-test`/`data-cy` → role + accessible name → stable `#id` → `tag[name=…]` → visible text → tag. Auto-generated ids (`:r1:`, `radix-…`, `mui-…`, trailing digit runs) are skipped because they change between builds.

## usecases.json (you write this)

```
app             string   base URL
usecases[]
  id            "UC-<CAT>-<nn>"
  title         imperative, actor-goal phrasing
  category      authentication | authorization | navigation | crud | <resource-name> | search | form | api | security | ux
  priority      P0 | P1 | P2 | P3
  actor         e.g. "registered user", "admin", "anonymous visitor"  (anonymous/guest/visitor → no auth fixture)
  auth          optional boolean override for the auth fixture
  status        optional "unverified" → generated as describe.fixme; omit when evidence exists
  preconditions string[]
  entry         path to open in beforeEach
  evidence      string[]  references into the inventory ("form#login on /login", "POST /api/auth/login 200")
  main_flow     (string | Step)[]
  expected      (string | Expectation)[]
  variants[]    { id, type: negative|boundary|security|accessibility|variant, title, steps?, expected? }
  locators      { key: locator object | shorthand string }
```

### Step (structured)
```
{ action: goto|fill|click|select|check|upload|expectUrl|expectVisible|expectHidden|expectText|expectCookie|expectNoCookie|expectResponse,
  target?: locator key | path | url fragment, value?: string }
```

### Free-text steps the generator understands
- `Open /path` · `Go to /path`
- `Fill <key> with <value>` · `Enter <key> with <value>`
- `Click <key or visible text>` · `Click 'Save' button`
- `Select <option> in <key>`
- `Check <key>`

### Free-text expectations the generator understands
- `Redirect to /path` · `URL contains /path`
- `Cookie 'sid' set` · `No cookie 'sid'`
- `Shows 'text'` · `Displays 'text'`
- `Title contains 'text'`
- `Cookie 'sid' has HttpOnly and Secure flags` (any of HttpOnly / Secure / SameSite)

Values of the form `${NAME}` are emitted as `process.env.NAME` — use this for passwords and secrets; never put real credentials in `usecases.json`.

Anything else becomes `// TODO(verify)` and the test is emitted as `test.fixme` — intentional, so unreviewed tests can't pass vacuously.
