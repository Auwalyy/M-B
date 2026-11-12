# Security review

Review date: 12 November 2026 (Phase 6). Scope: the REST API, the web app and the deployment setup.
Method: the OWASP API Security Top 10 (2023) applied control by control to the code, plus a dependency
audit, response-header checks, and automated tests that try each attack (`apps/api/test/security.test.ts`,
`isolation.test.ts`, `auth.test.ts`, `platform.test.ts`, `transactions.test.ts`, and the end-to-end suite).

## OWASP API Security Top 10

| Risk | How the platform handles it | Tested by |
|---|---|---|
| **API1 Broken object level authorisation** | Every staff query goes through `AuthContext.branchFilter()` / `canAccessBranch()`; out-of-scope records answer **404**, the same as missing ones. Customers reach orders only through `/orders/mine` (matched to their account) or tracking (reference **and** the phone used). | Isolation matrix (every role × branch × resource), customer-to-customer order, receipt and cancel attempts, e2e (Abuja admin opening a Kano order) |
| **API2 Broken authentication** | Argon2id passwords; 15-minute access tokens held in memory only; httpOnly, `SameSite=Lax`, path-scoped refresh cookie that rotates on every use, with reuse detection that revokes the whole session; account lockout after repeated failures; identical errors for unknown accounts and wrong passwords; rate-limited sign-in; staff with temporary passwords must change them before doing anything else; sessions end immediately on deactivation or password change. | `auth.test.ts` (lockout, enumeration, token tampering, replay, CSRF origin check) |
| **API3 Broken object property level authorisation** | Every request body is a strict Zod schema, so unknown fields (role, permissions, status) are dropped. Responses are built by DTO functions, never by returning database documents. Cost prices are `select: false` and only added for `inventory:read-cost`; the public never sees stock counts, only "In stock / Low / Out". | Smuggled `role`/`roleKey`/`permissions` on sign-up and profile; public product, availability and listing responses checked for cost and quantity fields |
| **API4 Unrestricted resource consumption** | Global, sign-in and "sensitive" rate limits; page size ≤ 100; cart line quantity ≤ 100; 1 MB JSON bodies; image uploads limited by size, count and sniffed type; report ranges ≤ 731 days and CSV exports ≤ 50,000 rows, streamed from a cursor. | Limit, quantity and range rejections; oversized bodies; sign-in rate limit |
| **API5 Broken function level authorisation** | Each route declares its permission in one place (`ModuleRouter.route`), checked before validation or uploads. Company-only permissions cannot be given to branch roles. | Customers and sales staff against management routes (users, settings, branches, roles, reports, audit) |
| **API6 Unrestricted access to sensitive business flows** | Prices, discounts, delivery fees and totals are always computed on the server; checkout needs an idempotency key; stock is held atomically inside transactions so it cannot be oversold; payment success comes only from Paystack verification or its signed webhook, with amount and currency matched; orders cannot complete with money owed; refunds are capped by what was paid. | Price-tampering checkout, concurrency tests for stock, forged and mismatched Paystack events |
| **API7 Server-side request forgery** | The API never fetches a URL supplied by a user. Outbound calls go only to fixed hosts (Paystack, Meta, Cloudinary); images are uploaded as bytes. | Code review |
| **API8 Security misconfiguration** | Helmet headers on the API; CSP, HSTS, frame blocking, `nosniff`, referrer and permissions policies on the web app; CORS limited to the web origin; cookie requests from other origins rejected; Swagger off in production; `x-powered-by` off; uniform error envelope without stack traces; the API **refuses to start** in production with a weak or example JWT secret, a non-HTTPS `WEB_URL`, or insecure cookies. | Header tests (API and web), CORS test, production-guard test |
| **API9 Improper inventory management** | One versioned prefix (`/api/v1`); the OpenAPI document is generated from the same route definitions that run, and a test fails if any route is missing from it; no hidden debug routes. | OpenAPI coverage test |
| **API10 Unsafe consumption of APIs** | Paystack webhooks are verified with HMAC-SHA512 over the raw body, WhatsApp webhooks with HMAC-SHA256; each event is processed once (unique event keys); amounts and currency are re-checked against our own records; provider responses are validated before use. | Webhook signature, replay and mismatch tests |

### Other controls

- **NoSQL injection:** `strictQuery`, the simple query parser (no nested `?a[$ne]=`), and Zod schemas on every input. Tested in `platform.test.ts`.
- **Audit trail:** security-relevant actions (sign-ins, permission changes, stock corrections, refunds, report downloads) are written in the same transaction as the change; the audit collection cannot be edited through the application, and secrets are redacted before storage.
- **Spreadsheet formula injection:** CSV cells starting with `=`, `+`, `-`, `@` or control characters are prefixed with `'` (plain numbers such as phone numbers are left alone).
- **XSS:** React escapes all output; the two JSON-LD blocks escape `<`; no user HTML is rendered.
- **Secrets:** only `NEXT_PUBLIC_SITE_URL` reaches the browser. Card details never touch our servers (Paystack hosted checkout). `.env` files and `deploy/api.env` are git-ignored.

## Dependency audit

`npm audit --omit=dev`: **0 vulnerabilities** in production dependencies (CI now fails on any high or critical one).

`npm audit` including development tools reports 10 moderate advisories, all from one source: `minimatch` inside ESLint and typescript-eslint (a regular-expression denial of service in glob matching). They run only on developer machines and CI against our own files, never in production. npm's suggested "fix" downgrades ESLint a major version, so it is not applied; re-check when typescript-eslint publishes an update.

## Residual risks and recommendations

1. **CSP allows inline scripts.** Next.js needs them unless every page uses per-request nonces, which would make all pages dynamic and slower. No third-party scripts load, and React escaping is the main XSS defence. Revisit if third-party scripts are ever added.
2. **Rate limits are per API process.** Correct for the recommended single API instance. Before running several instances, move the limiter to a shared store (Redis) — see DEPLOYMENT.md, Scaling.
3. **Registration reveals whether a phone number or email is already registered** (to show a helpful error). Sign-in and password reset do not. Rate limiting reduces bulk probing; accept or change to a generic message if this matters.
4. **Two-factor sign-in for staff** is not built. Recommended next step for super admins and branch admins.
5. **Backups and monitoring** depend on the hosting setup; DEPLOYMENT.md lists what to enable before launch.
6. **Penetration test:** this was an internal review. A short external test before handling large card volumes is worthwhile.

## Reporting a problem

Email the site owner (see the contact page) with the steps to reproduce. Please do not test against the live shop with real customer data.
