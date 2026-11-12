# API conventions

The full, always-current reference is generated from the code:

- Swagger UI: `GET /api/docs`
- OpenAPI 3.1 JSON: `GET /api/docs/openapi.json`

Both are on by default outside production (`API_DOCS_ENABLED`). Every route is registered through `ModuleRouter.route()` ([apps/api/src/core/http/route.ts](../apps/api/src/core/http/route.ts)). Validation, authorisation and documentation therefore come from the same definition, and a test checks that every route is documented.

## Base URL and versioning

All endpoints live under `/api/v1`. The web app calls `/api/v1/...` on its own origin, and Next.js proxies the request to the API.

## Responses

```jsonc
// Single resource
{ "data": { ... } }

// List
{ "data": [ ... ], "meta": { "page": 1, "limit": 20, "total": 57, "pages": 3 } }

// Error
{ "error": { "code": "VALIDATION_ERROR", "message": "Some fields are invalid",
             "details": { "phone": ["Enter a valid phone number, e.g. 0803 123 4567"] },
             "requestId": "5b1d…" } }
```

| Status | Typical codes |
|---|---|
| 400 | `BAD_REQUEST`, `MALFORMED_JSON`, `BRANCHES_REQUIRED`, `RESET_TOKEN_INVALID`, `LAST_SUPER_ADMIN` |
| 401 | `UNAUTHENTICATED`, `TOKEN_INVALID` (refresh and retry), `SESSION_INVALID`, `INVALID_CREDENTIALS`, `REFRESH_RACE` (retry once) |
| 403 | `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED`, `FIELD_NOT_EDITABLE`, `ACCOUNT_DISABLED`, `ORIGIN_NOT_ALLOWED` |
| 404 | `NOT_FOUND` (also returned for records in another branch, so their existence is not revealed), `ROUTE_NOT_FOUND` |
| 409 | `DUPLICATE`, `ACCOUNT_EXISTS`, `STALE_RECORD` |
| 413 / 422 / 423 / 429 | `PAYLOAD_TOO_LARGE` / `VALIDATION_ERROR` / `ACCOUNT_LOCKED` / `RATE_LIMITED` |

Every response carries an `X-Request-Id` header. Quote it when reporting a problem; it appears in the server logs and the activity log.

## Authentication

1. `POST /auth/login` with `{ identifier, password }`, where `identifier` is an email address or a phone number in any common Nigerian format. It returns `{ accessToken, expiresIn, user }` and sets the `mb_rt` refresh cookie (httpOnly, path `/api/v1/auth`).
2. Send `Authorization: Bearer <accessToken>` on every call. Access tokens last 15 minutes.
3. On `401 TOKEN_INVALID`, call `POST /auth/refresh`. It rotates the refresh cookie and returns a new access token. If an already-used refresh token is presented after the 30-second grace window, the whole session is revoked.
4. `POST /auth/logout` revokes the session.
5. `POST /auth/refresh` with no refresh cookie at all answers **204** with no body: the visitor is simply signed out. A missing session never logs an error in the browser.

Each request reloads the session and the user. Sign-out, deactivation, role edits and branch changes therefore apply on the very next request.

## Cart and checkout

- Guests are identified by the `mb_cart` cookie (httpOnly, path `/api/v1`, 30 days); signed-in users by their account. Call `POST /cart/merge` after sign-in to move a guest cart into the account.
- `POST /checkout/quote` prices the cart on the server and lists anything blocking the order in `problems`. `POST /checkout` recalculates everything (client-sent prices are ignored) and needs a unique `idempotencyKey`. Retrying with the same key returns the same order.
- Placing an order holds the units in stock (`reserved`); cancelling releases them.
- `GET /orders/track?reference=&phone=` returns a minimal public tracking view; the phone must match the one used at checkout.

## Analytics and reports

- Every `/analytics` and `/reports` route needs `reports:read` and covers only the caller's branches. `branch=<id>` narrows to one branch; a branch outside the caller's scope answers **404**.
- Dated routes take `from` and `to` as inclusive `YYYY-MM-DD` days in Africa/Lagos time (default: the last 30 days; at most 731 days). Overview figures include `previous`, the same-length period just before.
- Figures follow the revenue definitions in FOUNDATION §1.5. Collected revenue, refunds, outstanding balances and `/reports/payments` also need `reports:financial` for every branch shown; stock value at cost needs `inventory:read-cost`. Without them those fields are `null`, and `access` in the response says which applies.
- Reports return `{ range, summary, rows, page, limit, total, pages }`. The summary covers the whole range, not just the page. Add `format=csv` to download every row (up to 50,000) as UTF-8 CSV with amounts in naira. Each download is written to the activity log as `report.exported`. Text that a spreadsheet could run as a formula is prefixed with `'`.

## Authorisation model

- Each role has a set of **permissions** (`branches:read`, `users:create`, …), defined in [packages/shared/src/permissions.ts](../packages/shared/src/permissions.ts).
- Each role also has a **scope**:
  - `company`: every branch (Super Admin)
  - `branch`: only the user's assigned branches, plus any time-limited **branch access grants** issued by the Super Admin
  - `self`: only the user's own records (customers)
- Services ask `AuthContext.branchFilter(permission)` for a MongoDB filter, so a branch-scoped query cannot forget the restriction.
- Some permissions are **head-office only** (creating branches, editing roles and settings, managing the catalogue). They can never be given to branch-scoped roles.

## Conventions

- Money: integer **kobo** (`₦1 = 100`).
- Phone numbers: accepted in local formats, stored and returned in E.164 (`+2348031234567`).
- Dates: ISO 8601 UTC. The UI displays Nigeria time (`Africa/Lagos`).
- Pagination: `?page=1&limit=20` (maximum 100). Search: `?q=`.
- Unknown body fields are ignored. Operator-style input (`{"$gt": ""}`) fails validation.
