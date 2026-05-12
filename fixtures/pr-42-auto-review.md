# PR Review Handover: #42

**PR:** https://github.com/example/repo/pull/42
**Branch:** feat/user-auth → main
**Head SHA:** abc1234567890abcdef1234567890abcdef12345
**Base SHA:** def5678901234abcdef5678901234abcdef56789
**Generated:** 2024-01-15T10:30:00Z
**Status:** PENDING REVIEW
**Source counts:** 4 auto-review findings, 2 human reviewer comments, 6 total (2 critical, 2 important, 2 suggestion/nit)

---

## [?] auto:critical — src/router.ts:42

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review
**Comment:** The `handleRequest` function does not validate the Authorization header before passing raw user input to downstream handlers, allowing empty token strings to propagate.
**Analysis:** A missing or empty Bearer token results in an empty string being passed to `createPost`, `updatePost`, and `deletePost`. The downstream API client forwards the request with `Authorization: Bearer ` which some servers accept as anonymous.
**Recommendation:** Validate that the token is non-empty before dispatching to authenticated routes. Return 401 immediately if missing.
**Options:**
- Option A: Add a `requireAuth` middleware that extracts and validates the token, returning 401 on failure.
- Option B: Validate inline per route handler and return early.
**Resolution:** <!-- mark with [x] when resolved -->

---

## [x] reviewer:@alice — review body

**Severity:** important
**Source:** reviewer
**Reported by:** @alice
**Comment:** Overall the route matching logic is clean, but the error shape returned by `json()` when `result.ok` is false hardcodes status 400. Some errors (e.g. not-found from the API) should propagate with 404.
**Analysis:** The `json` helper maps all `!result.ok` responses to HTTP 400. This hides the original error type from API consumers making it impossible to distinguish validation errors from not-found.
**Recommendation:** Thread an optional `statusCode` field through `ApiError` and use it in the `json` helper, falling back to 400.
**Options:**
- Option A: Extend `ApiError` with an optional `statusCode` field and read it in `json()`.
- Option B: Add a separate `notFound()` helper for 404 cases.
**Resolution:** Acknowledged — will extend ApiError in follow-up ticket.

---

## [~] auto:important — src/api-client.ts:12

**Severity:** important
**Source:** auto-review
**Reported by:** auto-review
**Comment:** The `request` helper swallows JSON parse errors with `.catch(() => ...)`, silently substituting a generic error object. This makes diagnosing server-side errors very difficult.
**Analysis:** When `res.json()` throws (e.g. server returns HTML error page), the catch clause produces `{ code: 'UNKNOWN', message: res.statusText }` which loses all diagnostic information from the response body.
**Recommendation:** Log the raw response text before falling back, or re-throw as a structured error with the raw body attached.
**Options:**
- Option A: Capture raw text via `res.text()`, log it, then attempt JSON parse.
- Option B: Include raw response body in the `ApiError.details` field.
**Resolution:** <!-- mark with [x] when resolved -->

---

## [d] auto:critical — src/router.ts:42

**Severity:** critical
**Source:** auto-review
**Reported by:** auto-review, @alice
**Comment:** Unauthenticated DELETE endpoint exposes destructive operation without authorization check. Same root location as item 1.
**Analysis:** The DELETE handler extracts the token exactly as POST/PATCH do — if the token is empty the delete proceeds. Combined with the missing auth validation this allows unauthenticated deletes.
**Recommendation:** Same fix as item 1 — apply `requireAuth` middleware to all mutating routes.
**Options:**
- Option A: Shared `requireAuth` guard applied at route registration time.
- Option B: Inline check per handler.
**Note:** also flagged by @alice
**Resolution:** <!-- mark with [x] when resolved -->

---

## [-] auto:suggestion — src/api-client.ts:5

**Severity:** suggestion
**Source:** auto-review
**Reported by:** auto-review
**Comment:** `BASE_URL` is read from `process.env` at module load time, preventing runtime reconfiguration and making the module hard to test in isolation.
**Analysis:** Module-level constant evaluation means tests must set the environment variable before importing, which can cause ordering issues in test suites.
**Recommendation:** Accept `baseUrl` as a parameter to a factory function or export a `configure` function.
**Options:**
- Option A: Export `createApiClient(baseUrl: string)` factory.
- Option B: Export `configure({ baseUrl }: ApiClientConfig)` to set module-level state.
**Resolution:** <!-- mark with [x] when resolved -->

---

## [?] reviewer:@alice — src/types.ts:8

**Severity:** nit
**Source:** reviewer
**Reported by:** @alice
**Comment:** `User.createdAt` is typed as `Date` but the API returns ISO strings. This will silently be a string at runtime unless explicit parsing is applied.
**Analysis:** TypeScript's type system cannot enforce JSON parse coercion — callers that use `createdAt` as a `Date` will get a string at runtime. This is a latent bug.
**Recommendation:** Either type as `string` and parse at the call site, or use a DTO/domain split pattern.
**Options:**
- Option A: Change `createdAt` to `string` in the API types, parse to `Date` in domain model.
- Option B: Add a `deserializeUser(raw: unknown): User` function that does explicit date parsing.
**Resolution:** <!-- mark with [x] when resolved -->
