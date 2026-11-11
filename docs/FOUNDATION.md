# Mudassir & Brothers — Platform Foundation

Status: **Approved 2026-11-10** (decisions D1–D9 accepted as proposed; D6 Cloudinary confirmed) · Phases 1–5 complete

Implementation notes since approval: the API runs on port **4100** by default (4000 was taken on the development machine). Media storage (`core/storage`) is in place, with Cloudinary in production and local disk in development. Background jobs (`core/jobs`) arrive with reservations in Phase 4. The transactional outbox and its worker exist already.

This document defines the foundation for the multi-branch retail and e-commerce platform. It has five parts: system architecture, folder structure, database schema, API module breakdown, and development roadmap. Section 6 lists the decisions that need sign-off before Phase 1 starts.

---

## 1. System Architecture

### 1.1 Overview

```
                ┌──────────────────────────────────────────────┐
  Customers ───▶│  apps/web  (Next.js, App Router, TypeScript) │◀─── Staff / Admins
  (mobile-first)│  • Storefront  (SSR/ISR, SEO)                │     (role-based dashboards)
                │  • /admin      (client-rendered dashboards)  │
                └───────────────┬──────────────────────────────┘
                                │  HTTPS, same-site
                                │  /api/*  → rewritten to API (first-party cookies)
                ┌───────────────▼──────────────────────────────┐
                │  apps/api  (Express 5, TypeScript)           │
                │  Modular monolith                             │
                │  ┌────────┐ ┌────────┐ ┌──────────┐ ┌──────┐ │
                │  │ auth   │ │branches│ │ catalog  │ │ inv. │ │
                │  ├────────┤ ├────────┤ ├──────────┤ ├──────┤ │
                │  │ crm    │ │ orders │ │ reserv.  │ │ pay  │ │
                │  ├────────┤ ├────────┤ ├──────────┤ ├──────┤ │
                │  │delivery│ │notific.│ │analytics │ │audit │ │
                │  └────────┘ └────────┘ └──────────┘ └──────┘ │
                │  Shared kernel: authz, branch scope, errors,  │
                │  validation, transactions, event bus, jobs    │
                └──┬──────────┬───────────┬───────────┬────────┘
                   │          │           │           │
            ┌──────▼───┐ ┌────▼─────┐ ┌───▼──────┐ ┌──▼──────────────┐
            │ MongoDB  │ │ Paystack │ │ SMTP     │ │ Media storage   │
            │ replica  │ │ API +    │ │ (email)  │ │ (Cloudinary /   │
            │ set      │ │ webhooks │ │          │ │  S3-compatible) │
            └──────────┘ └──────────┘ └──────────┘ └─────────────────┘
                                         WhatsApp Cloud API (optional; used only when configured)
```

### 1.2 Key architectural decisions

| Concern | Decision | Rationale |
|---|---|---|
| Repo layout | npm workspaces monorepo: `apps/web`, `apps/api`, `packages/shared` | Two independent apps that deploy separately and share Zod schemas, enums and permission constants. |
| Backend style | Modular monolith. Each module owns its models, service, controller, routes, validators and tests. Modules talk to each other through service interfaces and an in-process event bus, never through each other's models. | Clear boundaries now, with the option to split modules out later. |
| Database | MongoDB **replica set** (Atlas in production; a single-node replica set in Docker for development) | Multi-document **transactions** are needed to prevent overselling, and they require a replica set. |
| Money | Integer **kobo** (`₦1 = 100`), currency `NGN` | No floating-point rounding errors. |
| Auth | Short-lived JWT access token (15 min, held in memory) and a rotating refresh token (httpOnly, Secure, SameSite=Lax cookie, stored **hashed** in the `sessions` collection, 30 days) | Sessions can be revoked, token reuse is detected, and no token sits in `localStorage`. |
| Passwords | argon2id | Current best practice. |
| Authorization | RBAC (permission strings on Roles) **plus** branch scoping. Middleware resolves `req.auth.branchScope` to `ALL` or a list of branch IDs, and every repository query for branch-owned data **requires** that scope. | Branch isolation is enforced in one place on the backend and cannot be forgotten. |
| Validation | Zod schemas in `packages/shared`, used by Express middleware and by frontend forms (react-hook-form) | One definition for both sides. Strict parsing also blocks NoSQL operator injection. |
| Concurrency | Conditional atomic updates (`available ≥ qty`) inside a transaction, plus optimistic concurrency (`versionKey`) on documents with state machines | No overselling and no lost status updates. |
| Background jobs | `node-cron` with a Mongo lease lock (`jobLocks` collection) | Handles reservation expiry, low-stock digests and the notification outbox without needing Redis. Can be swapped for BullMQ later. |
| Notifications | Transactional **outbox**: events are written in the same transaction as the business change, and a worker delivers them to in-app, email and WhatsApp (when configured) | A notification is never lost when the business change succeeds, and never sent when it fails. |
| Payments | Paystack: the server initialises the transaction, and **only** server-side verification (Verify API + HMAC-SHA512-signed webhook) marks it paid. All processing is idempotent on the reference. | Meets requirement 13: the frontend is never trusted. |
| Media | `StorageProvider` interface. Cloudinary in production, local disk in development | Image transforms and a CDN, with no lock-in. |
| API docs | OpenAPI 3.1 generated from the Zod schemas (`@asteasolutions/zod-to-openapi`), Swagger UI at `/api/docs` | The docs cannot drift from the code. |
| Logging | pino (JSON), with a request ID on every log line and every error response | Errors are traceable in production. |
| Security | helmet, strict CORS, rate limits (global plus stricter limits on auth, checkout and enquiries), body size limits, Zod validation, centralized error handler (no stack traces in production), audit log | Requirement 17. |
| Frontend data | Server Components for SEO pages. TanStack Query for dashboards. Next.js rewrites `/api/*` to the API, so cookies stay first-party | Fast, SEO-friendly storefront and simple auth. |
| UI | Tailwind CSS and our own design-system components built on Radix primitives (accessible); Recharts for charts; lucide icons | Accessible and consistent, without a generic template look. |
| Testing | Vitest, Supertest and `mongodb-memory-server` (replica-set mode, so transactions are tested for real), React Testing Library, Playwright for end-to-end | Requirement 20.11 and 20.17. |

### 1.3 Request lifecycle (protected endpoint)

```
request → requestId → helmet/cors → rateLimit → parse (size-limited)
        → authenticate (JWT) → authorize(permission) → resolveBranchScope
        → validate(zod: params/query/body) → controller → service (transaction)
        → audit + outbox (same transaction) → response envelope
        → errorHandler (AppError → {error:{code,message,details,requestId}})
```

Response envelope: `{ "data": ..., "meta": { "page", "limit", "total" } }`. Errors use `{ "error": { "code": "INSUFFICIENT_STOCK", "message": "...", "details": {...}, "requestId": "..." } }`.

### 1.4 Branch isolation model

- Each branch-owned document (Inventory, InventoryMovement, Order, Reservation, Payment, Delivery, Enquiry, StockTransfer) has a required, indexed `branch` field.
- `branchScope` is resolved per request:
  - `SUPER_ADMIN` → `ALL`.
  - `BRANCH_ADMIN` and `SALES_STAFF` → `user.branches` plus any **active, unexpired** `branchAccessGrants` the super admin has issued (requirement 3B, "unless explicitly authorized").
  - `CUSTOMER` → none. Customer endpoints filter by `customer = self` instead.
- Repositories expose `findScoped(scope, filter)`. A request for an out-of-scope ID returns **404**, not 403, so the response does not reveal whether the record exists.
- Customers are a **central identity**. Branch staff can see a customer only if the customer has an order, reservation or enquiry in one of their branches, or names one of their branches as preferred. This is enforced with an indexed `customer.branchesServed` array.

### 1.5 Revenue definitions (used by every report)

| Metric | Definition |
|---|---|
| **Gross sales** | Sum of `order.total` for orders in `confirmed → completed` (excluding `cancelled` and `refunded`), dated by `confirmedAt` |
| **Collected revenue** | Sum of verified `payment.amount` (status `success`) minus processed refunds, dated by `verifiedAt` and attributed to `payment.branch` |
| **Outstanding balance** | `order.total − sum of successful payments + refunds` for non-cancelled orders |
| **Inventory value** | Σ(`quantity × costPrice`) per branch. Cost price is visible only to the super admin and branch admins |
| **Units sold** | Σ `items.quantity` on completed orders |

Dashboards label which metric they show. All times use `Africa/Lagos`.

---

## 2. Folder Structure

```
M&B/
├── package.json                  # npm workspaces, root scripts (dev, build, test, lint)
├── tsconfig.base.json
├── .editorconfig  .prettierrc  eslint.config.mjs
├── docker-compose.yml            # mongo (single-node replica set), mailpit (dev SMTP)
├── .github/workflows/ci.yml      # lint, typecheck, test, build
├── docs/
│   ├── FOUNDATION.md             # this file
│   ├── API.md                    # generated index + link to /api/docs
│   ├── DEPLOYMENT.md
│   └── adr/                      # architecture decision records
│
├── packages/
│   └── shared/                   # @mb/shared
│       └── src/
│           ├── enums/            # roles, order/reservation/payment statuses, etc.
│           ├── permissions.ts    # permission strings + default role maps
│           ├── schemas/          # zod schemas per module (requests & DTOs)
│           ├── money.ts          # kobo helpers, formatNaira
│           ├── phone.ts          # Nigerian phone normalisation (E.164)
│           └── index.ts
│
├── apps/
│   ├── api/                      # @mb/api
│   │   ├── .env.example
│   │   ├── src/
│   │   │   ├── server.ts         # bootstrap: db, jobs, http
│   │   │   ├── app.ts            # express app composition
│   │   │   ├── config/           # env (zod-validated), logger, db
│   │   │   ├── core/
│   │   │   │   ├── errors/       # AppError, error codes, errorHandler
│   │   │   │   ├── http/         # response envelope, pagination, asyncHandler
│   │   │   │   ├── middleware/   # requestId, authenticate, authorize, branchScope,
│   │   │   │   │                 # validate, rateLimit, upload
│   │   │   │   ├── db/           # withTransaction, counters (references), plugins
│   │   │   │   ├── events/       # event bus + outbox writer
│   │   │   │   ├── jobs/         # scheduler + lease lock
│   │   │   │   ├── storage/      # StorageProvider (local, cloudinary)
│   │   │   │   └── openapi/      # registry + swagger route
│   │   │   ├── modules/
│   │   │   │   ├── auth/         # login, refresh, logout, password reset, sessions
│   │   │   │   ├── users/        # staff accounts, roles, branch access grants
│   │   │   │   ├── branches/
│   │   │   │   ├── catalog/      # products, categories, brands, media
│   │   │   │   ├── inventory/    # stock levels, movements, adjustments, transfers
│   │   │   │   ├── customers/    # CRM, segments, communication log
│   │   │   │   ├── cart/
│   │   │   │   ├── orders/
│   │   │   │   ├── reservations/
│   │   │   │   ├── payments/     # paystack provider, webhooks, receipts, refunds
│   │   │   │   ├── delivery/     # zones, fees, assignments
│   │   │   │   ├── promotions/
│   │   │   │   ├── enquiries/    # incl. WhatsApp link builder & manual logging
│   │   │   │   ├── notifications/# in-app, email, whatsapp channels, outbox worker
│   │   │   │   ├── analytics/    # dashboards & reports (aggregations)
│   │   │   │   ├── settings/     # company settings, reservation policy
│   │   │   │   └── audit/        # audit log + login activity
│   │   │   │       # each module: *.model.ts *.service.ts *.controller.ts
│   │   │   │       #              *.routes.ts *.openapi.ts __tests__/
│   │   │   └── scripts/
│   │   │       ├── seed.ts       # dev seed: branches (Kano/Abuja), users, catalog, stock
│   │   │       └── create-super-admin.ts
│   │   └── test/                 # integration test setup (memory replica set), factories
│   │
│   └── web/                      # @mb/web
│       ├── .env.example
│       ├── next.config.ts        # /api rewrites, image domains
│       ├── src/
│       │   ├── app/
│       │   │   ├── (store)/      # public storefront
│       │   │   │   ├── page.tsx                  # home
│       │   │   │   ├── shop/  categories/[slug]/  products/[slug]/
│       │   │   │   ├── search/  branches/  about/  contact/
│       │   │   │   ├── cart/  checkout/  track/[ref]/
│       │   │   │   └── account/  (orders, reservations, profile)
│       │   │   ├── (auth)/       # login, register, forgot/reset password
│       │   │   ├── admin/        # role-based dashboards (guarded layout)
│       │   │   │   ├── page.tsx  # dashboard (super/branch variant)
│       │   │   │   ├── branches/ products/ categories/ brands/
│       │   │   │   ├── inventory/ (levels, movements, transfers, adjustments)
│       │   │   │   ├── customers/ orders/ reservations/ payments/
│       │   │   │   ├── deliveries/ enquiries/ promotions/
│       │   │   │   ├── reports/ staff/ settings/ audit/ notifications/
│       │   │   ├── sitemap.ts  robots.ts
│       │   ├── components/
│       │   │   ├── ui/           # design system: Button, Input, Select, Dialog,
│       │   │   │                 # DataTable, Badge, Card, Skeleton, EmptyState, Toast…
│       │   │   ├── store/        # ProductCard, BranchPicker, AvailabilityList, WhatsAppButton…
│       │   │   └── admin/        # Sidebar, StatCard, StatusTimeline, StockBadge, charts…
│       │   ├── lib/              # api client, auth context, query keys, formatters
│       │   ├── hooks/
│       │   └── styles/           # tailwind tokens (brand colours, typography)
│       └── e2e/                  # Playwright specs
```

---

## 3. Database Schema

Conventions: every collection has `timestamps` (`createdAt` and `updatedAt`). Money fields are integers in kobo. `ref → X` is an ObjectId reference. Mutable records are soft-deactivated with `status` and never hard-deleted. Unique human-readable references come from an atomic `counters` collection, for example `ORD-KAN01-260001`.

### 3.1 Identity and access

**Role** (`roles`)
| Field | Type | Notes |
|---|---|---|
| key | string, unique | `SUPER_ADMIN`, `BRANCH_ADMIN`, `SALES_STAFF`, `CUSTOMER` |
| name, description | string | |
| permissions | string[] | e.g. `inventory:adjust`, `orders:update-status`, `payments:record` |
| isSystem | bool | system roles cannot be deleted |

**User** (`users`): login identities for staff and customers
| Field | Type | Notes |
|---|---|---|
| fullName | string | |
| email | string, unique sparse, lowercase | |
| phone | string, unique sparse, E.164 | customers may log in with phone |
| passwordHash | string, `select:false` | argon2id |
| role | ref → Role | |
| branches | ref → Branch[] | staff assignment (required for BRANCH_ADMIN and SALES_STAFF) |
| branchAccessGrants | `[{ branch, permissions[], grantedBy, expiresAt }]` | explicit cross-branch authorization by the super admin |
| customer | ref → Customer | set for CUSTOMER users |
| status | enum `active, suspended, deactivated` | |
| lastLoginAt, passwordChangedAt | date | |
| Indexes | `{role,status}`, `{branches:1}` | |

**Session** (`sessions`): refresh tokens: `user`, `tokenHash` (unique), `family` (for detecting reuse), `userAgent`, `ip`, `expiresAt` (TTL index), `revokedAt`.

**PasswordResetToken**: `user`, `tokenHash`, `expiresAt` (TTL), `usedAt`.

### 3.2 Branches and settings

**Branch** (`branches`)
| Field | Type | Notes |
|---|---|---|
| name | string | |
| code | string, unique, uppercase | e.g. `KAN01`, `ABJ01`. Used in references |
| location | `{ area, landmark, geo: {type:'Point', coordinates} }` | 2dsphere index (nearest branch, later) |
| address, city, state | string | `state` in {Kano, FCT, …} (open list) |
| phone, whatsapp | string E.164 | |
| email | string | |
| admins | ref → User[] | kept in sync with `User.branches` |
| openingHours | `[{ day: 0-6, open: "08:00", close: "18:00", closed: bool }]` | |
| status | enum `active, inactive` | inactive branches are hidden from the storefront |
| settings | `{ reservationsEnabled, reservationHoldHours, pickupEnabled, deliveryEnabled }` | overrides company defaults |

**Setting** (`settings`): a single company document: name, contact details, default WhatsApp, logo, reservation policy (`pendingExpiryHours`, `confirmedHoldHours`, `maxQtyPerReservation`), low-stock default, tax/VAT flag, receipt footer, delivery defaults.

### 3.3 Catalog

**Category**: `name`, `slug` (unique), `parent` (ref → Category, nullable; supports a tree), `image`, `description`, `sortOrder`, `status`. Index `{parent, sortOrder}`.

**Brand**: `name`, `slug` (unique), `logo`, `status`.

**Product** (`products`): company-wide
| Field | Type | Notes |
|---|---|---|
| name, slug (unique) | string | |
| sku | string, unique | base SKU, e.g. `SAM-TV-001` |
| productCode | string, unique | internal or barcode code |
| description | string (sanitized rich text) | |
| category | ref → Category | indexed |
| brand | ref → Brand | indexed |
| images | `[{ url, publicId, alt, sortOrder }]` | multiple |
| price | int (kobo) | selling price |
| compareAtPrice / discountPrice | int | `discountPrice < price` validated |
| costPrice | int, `select:false` | for inventory value; admin only |
| specifications | `[{ label, value }]` | |
| hasVariants | bool | |
| variants | `[{ _id, sku (unique across products), attributes: { size?, color?, … }, price?, discountPrice?, status }]` | embedded |
| tags | string[] | |
| isFeatured | bool | |
| status | enum `draft, active, inactive` | |
| searchText | text index on name, sku, brand name, tags | storefront search |
| Indexes | `{status, category, price}`, `{status, isFeatured}`, `{'variants.sku':1}` unique sparse, text | |

Related products are computed (same category or brand, excluding self). An optional manual `relatedProducts: ref[]` overrides them.

### 3.4 Inventory

**Inventory** (`inventories`): one document per (product, variant, branch)
| Field | Type | Notes |
|---|---|---|
| product | ref → Product | |
| variantId | ObjectId \| null | null for products without variants |
| sku | string | denormalised for lookups |
| branch | ref → Branch | |
| quantity | int ≥ 0 | on hand |
| reserved | int ≥ 0 | held by pending or confirmed reservations and unfulfilled orders |
| reorderLevel | int | low-stock threshold (falls back to company default) |
| isAvailable | bool | the branch can hide an item even when it is in stock |
| Indexes | **unique** `{product, variantId, branch}`, `{branch, sku}` | |
| Virtual | `available = quantity − reserved` | |

Stock is reserved atomically:
```ts
Inventory.updateOne(
  { _id, $expr: { $gte: [{ $subtract: ['$quantity', '$reserved'] }, qty] } },
  { $inc: { reserved: qty } }, { session })   // modifiedCount 0 → INSUFFICIENT_STOCK
```
Multi-line orders run inside one transaction, so either every line is reserved or none is. An authorized override (`inventory:override`, with a reason) skips the check and is audited.

**InventoryMovement** (`inventoryMovements`): an append-only ledger
`inventory`, `product`, `variantId`, `branch`, `type` (`stock_in, stock_out, adjustment, transfer_out, transfer_in, sale, reservation_hold, reservation_release, return`), `quantityDelta` (signed), `reservedDelta`, `balanceAfter`, `reference` (`{ kind: 'Order'|'Reservation'|'Transfer'|'Adjustment', id }`), `reason`, `performedBy`. Indexes `{branch, createdAt}` and `{inventory, createdAt}`.

**StockAdjustment** (`stockAdjustments`): adjustments that need approval
`branch`, `items[{inventory, delta, reason}]`, `status` (`pending, approved, rejected, applied`), `requestedBy`, `reviewedBy`, `reviewNote`. Adjustments above a configurable threshold, and every adjustment by sales staff, need approval.

**StockTransfer** (`stockTransfers`)
`reference`, `fromBranch`, `toBranch`, `items[{product, variantId, sku, quantity}]`, `status` (`requested, approved, rejected, in_transit, received, cancelled`), `requestedBy`, `approvedBy`, `dispatchedBy`, `receivedBy`, `history[]`. Stock is deducted at `in_transit` and added at `received`; both steps run in transactions and write ledger entries.

### 3.5 Customers and CRM

**Customer** (`customers`): central identity
| Field | Type | Notes |
|---|---|---|
| fullName | string | |
| phone | string E.164, **unique** | primary key for de-duplication across branches |
| email | string, sparse unique | |
| addresses | `[{ label, line1, area, city, state, landmark, isDefault }]` | |
| user | ref → User | null for walk-in or guest customers |
| preferredBranch | ref → Branch | |
| branchesServed | ref → Branch[] | maintained on every transaction; drives branch-scoped visibility |
| source | enum `online, walk_in, whatsapp, phone, guest_checkout` | |
| registeredBy, registeredAtBranch | ref | staff registration |
| tags | string[] | manual segments (e.g. `wholesale`, `vip`) |
| stats | `{ orderCount, totalSpent, lastOrderAt, reservationCount }` | updated on order completion; used for segmentation |
| notes | string | |
| Indexes | text `{fullName, phone, email}`, `{branchesServed}`, `{'stats.totalSpent'}` | |

**CustomerInteraction** (`customerInteractions`): communication history
`customer`, `branch`, `channel` (`whatsapp, phone, email, in_store, system`), `direction` (`inbound, outbound`), `summary`, `relatedTo` (`{kind, id}`), `recordedBy`.

**Enquiry** (`enquiries`)
`reference`, `customer` (optional), `contact {name, phone, email}`, `branch`, `product?`, `channel` (`web_form, whatsapp, phone, walk_in`), `subject`, `message`, `status` (`new, in_progress, responded, converted, closed`), `assignedTo`, `notes[]`, `convertedTo` (`{kind:'Order'|'Reservation', id}`).

Segments are saved filter definitions evaluated at query time (for example, spent over ₦500k, no order in 90 days, preferred branch KAN01). They are stored in `customerSegments`: `name`, `filter` (validated JSON), `createdBy`.

### 3.6 Commerce

**Cart** (`carts`): `user` or `guestToken` (unique sparse), `branch` (selected fulfilment branch), `items[{product, variantId, quantity, addedAt}]`, `expiresAt` (TTL 30 days for guests). Prices are **always recomputed** on the server and never stored as truth in the cart.

**Promotion** (`promotions`): `name`, `code?` (unique sparse, uppercase), `type` (`percentage, fixed_amount, free_delivery`), `value`, `scope` (`{ products[], categories[], brands[], branches[] }`; empty means all), `minOrderAmount`, `maxDiscount`, `startsAt`, `endsAt`, `usageLimit`, `perCustomerLimit`, `usedCount`, `status`.

**Order** (`orders`)
| Field | Type | Notes |
|---|---|---|
| reference | string unique | `ORD-KAN01-260001` |
| channel | enum `online, in_store, whatsapp, phone` | |
| customer | ref → Customer | |
| branch | ref → Branch | indexed |
| items | **OrderItem[]** (see below) | |
| subtotal, discountTotal, deliveryFee, total | int (kobo) | server-computed |
| promotion | `{ id, code, discount }` | snapshot |
| fulfilment | `{ method: 'pickup'|'delivery', delivery: ref → Delivery }` | |
| paymentMethod | enum `paystack, bank_transfer, cash, pay_on_pickup, pay_on_delivery` | |
| paymentStatus | enum `unpaid, partially_paid, paid, refunded, partially_refunded` | derived from Payments |
| amountPaid | int | |
| status | enum `pending, confirmed, processing, ready_for_pickup, out_for_delivery, completed, cancelled, refunded` | |
| statusHistory | `[{ from, to, by, at, note }]` | every transition is recorded |
| fromReservation | ref → Reservation | |
| createdBy | ref → User | staff-created orders |
| confirmedAt, completedAt, cancelledAt | date | |
| Indexes | `{branch, status, createdAt}`, `{customer, createdAt}`, `{reference}` | |

**OrderItem**: a schema embedded in `Order.items` (see decision D1)
`product`, `variantId`, `sku`, `name`, `image`, `attributes`, `unitPrice`, `discount`, `quantity`, `lineTotal`. These are **snapshots**, so later price changes do not alter past orders.

Order state machine (enforced in the service, and validated per role):
```
pending → confirmed → processing → ready_for_pickup → completed
                                 ↘ out_for_delivery → completed
pending|confirmed|processing → cancelled   (releases reserved stock)
completed → refunded                       (optionally restocks via a return movement)
```
Stock moves from `reserved` to deducted (a `sale` movement) at `completed` for pickup orders and at `out_for_delivery` for delivery orders.

**Reservation** (`reservations`)
`reference` (`RSV-ABJ01-260001`), `customer`, `contact {name, phone, email}`, `branch`, `items[{product, variantId, sku, name, quantity, unitPrice}]`, `status` (`pending, confirmed, rejected, expired, converted, cancelled`), `statusHistory[]`, `expiresAt` (indexed; set from the policy), `reviewedBy`, `rejectionReason`, `convertedOrder`, `customerNote`.
Stock is **held on submission** (`reserved += qty`) and released on reject, expire or cancel. Pending reservations expire after `pendingExpiryHours`; confirmed ones after `confirmedHoldHours`. A job runs every 5 minutes to expire them.

**Payment** (`payments`)
| Field | Type | Notes |
|---|---|---|
| reference | string unique | our reference, also sent to Paystack |
| order | ref → Order | |
| branch, customer | ref | denormalised for reporting and scoping |
| method | enum (as order) | |
| amount | int | |
| status | enum `pending, success, failed, abandoned, reversed` | |
| provider | `{ name:'paystack', transactionId, channel, paidAt, raw }` | the `raw` response is stored for disputes |
| verifiedBy | `'webhook'|'verify_api'|User` | manual methods record the staff member who confirmed |
| verifiedAt | date | |
| receiptNumber | string unique | `RCP-…` |
| refunds | `[{ amount, reason, status, providerRefundId, by, at }]` | |
| Indexes | `{order}`, `{branch, verifiedAt}`, `{status, createdAt}` | |

**WebhookEvent** (`webhookEvents`): `provider`, `eventId`/`reference` (unique), `payload`, `processedAt`. Gives idempotency and replay protection.

**Delivery** (`deliveries`)
`order`, `branch`, `address {...}`, `contactPhone`, `zone` (ref → DeliveryZone), `fee`, `status` (`pending, assigned, picked_up, in_transit, delivered, failed, returned`), `assignedTo` (`{ user?, name, phone }`, for staff or a third-party rider), `history[]`, `proof` (`{ note, photoUrl }`).

**DeliveryZone** (`deliveryZones`): `branch`, `name` (e.g. "Kano – Within city"), `areas[]`, `fee`, `freeAbove?`, `estimatedDays`, `status`. This keeps delivery pricing configurable (requirement 14).

### 3.7 Platform

**Notification** (`notifications`): `recipient` (User), `type` (`order.created`, `reservation.created`, `stock.low`, …), `title`, `body`, `link`, `branch`, `readAt`, `channels {inApp, email:{status, sentAt, error}, whatsapp:{status, …}}`. Index `{recipient, readAt, createdAt}`.

**OutboxEvent** (`outboxEvents`): `type`, `payload`, `status` (`pending, processing, done, failed`), `attempts`, `nextAttemptAt`, `lastError`. The notification worker reads from here.

**AuditLog** (`auditLogs`): append-only
`actor` (User or `system`), `actorRole`, `branch?`, `action` (`order.status_changed`, `inventory.adjusted`, `user.role_changed`, `auth.login_failed`, …), `entity {kind, id}`, `before?`, `after?` (with sensitive fields redacted), `ip`, `userAgent`, `requestId`. Indexes `{createdAt}`, `{actor, createdAt}`, `{entity.kind, entity.id}`, `{branch, createdAt}`. Login activity is stored here (`auth.*` actions).

**Counter** (`counters`): `{ _id: 'ORD-KAN01-26', seq }` for atomic reference generation.

**JobLock** (`jobLocks`): `{ _id: jobName, lockedUntil, owner }`.

### 3.8 Entity relationships (summary)

```
Role 1─* User *─* Branch          User 0..1─1 Customer
Branch 1─* Inventory *─1 Product *─1 Category / Brand
Inventory 1─* InventoryMovement
Branch 1─* StockTransfer (from/to)    Branch 1─* StockAdjustment
Customer 1─* Order 1─* Payment        Order 0..1─1 Delivery *─1 DeliveryZone
Customer 1─* Reservation 0..1─1 Order (converted)
Customer 1─* Enquiry / CustomerInteraction
Order *─0..1 Promotion
User 1─* Notification     * ─ AuditLog (polymorphic entity)
```

---

## 4. API Module Breakdown

Base path: `/api/v1`. Every list endpoint supports `page`, `limit` (≤ 100), `sort` and module-specific filters. **SA** = Super Admin, **BA** = Branch Admin (own branches), **SS** = Sales Staff (own branch), **C** = Customer (self), **P** = Public.

### 4.1 Auth (`/auth`)
| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/auth/register` | P | Customer registration (creates or links a Customer by phone) |
| POST | `/auth/login` | P (rate-limited) | Email/phone and password |
| POST | `/auth/refresh` | cookie | Rotate the refresh token |
| POST | `/auth/logout` | auth | Revoke the session |
| POST | `/auth/forgot-password`, `/auth/reset-password` | P | Email reset |
| GET | `/auth/me` | auth | Profile, role, permissions, branch scope |
| PATCH | `/auth/me`, POST `/auth/change-password` | auth | |
| GET/DELETE | `/auth/sessions[/:id]` | auth | List or revoke own sessions |

### 4.2 Users and roles (`/users`, `/roles`)
| Method | Path | Access |
|---|---|---|
| GET/POST | `/users` | SA (all); BA (staff in own branch, may create SS if permitted) |
| GET/PATCH | `/users/:id` | SA; BA (own branch staff) |
| POST | `/users/:id/deactivate`, `/activate`, `/reset-password` | SA; BA (own SS) |
| PUT | `/users/:id/branches` | SA (assign admins and staff to branches) |
| POST/DELETE | `/users/:id/branch-access-grants[/:grantId]` | SA (cross-branch authorization) |
| GET/PATCH | `/roles`, `/roles/:id` | SA (view and edit permission sets) |

### 4.3 Branches (`/branches`)
| Method | Path | Access |
|---|---|---|
| GET | `/branches` | P (active, public fields) · SA (all, full) |
| GET | `/branches/:idOrCode` | P (public) · BA (own, full) |
| POST | `/branches` | SA |
| PATCH | `/branches/:id` | SA (all fields) · BA (profile, hours, contact, branch settings) |
| POST | `/branches/:id/deactivate` | SA |

### 4.4 Catalog (`/products`, `/categories`, `/brands`)
| Method | Path | Access |
|---|---|---|
| GET | `/products` | P: active only; `q, category, brand, minPrice, maxPrice, branch, inStock, featured, sort` |
| GET | `/products/:slug` | P: details plus **branch availability** (`in_stock` / `low` / `out`; exact counts hidden from the public) |
| GET | `/products/:slug/related` | P |
| GET | `/products/:id/availability` | P (status per branch) · staff (exact quantities in scope) |
| POST/PATCH | `/products`, `/products/:id` | SA |
| POST | `/products/:id/images` (multipart), DELETE `/products/:id/images/:imageId`, PATCH `.../images/order` | SA |
| POST | `/products/:id/status` | SA |
| GET/POST/PATCH | `/categories`, `/brands` (+ `/:id`) | P (GET) · SA (write) |

### 4.5 Inventory (`/inventory`)
| Method | Path | Access |
|---|---|---|
| GET | `/inventory` | SA (all) · BA/SS (own branch): `branch, q, lowStock, outOfStock` |
| GET | `/inventory/:id/movements`, `/inventory/movements` | SA · BA |
| POST | `/inventory/stock-in` | SA · BA |
| POST | `/inventory/stock-out` | SA · BA |
| PATCH | `/inventory/:id` | SA · BA (reorder level, availability toggle) |
| POST/GET | `/inventory/adjustments` | SA · BA · SS (request only) |
| POST | `/inventory/adjustments/:id/approve`, `/reject` | SA · BA (not their own request) |
| POST/GET | `/inventory/transfers` | SA · BA (request from or to own branch) |
| POST | `/inventory/transfers/:id/approve`, `/reject`, `/dispatch`, `/receive`, `/cancel` | SA approves; source BA dispatches; destination BA receives |
| GET | `/inventory/low-stock` | SA · BA |

### 4.6 Customers / CRM (`/customers`, `/enquiries`)
| Method | Path | Access |
|---|---|---|
| GET/POST | `/customers` | SA (all) · BA/SS (served by own branch; SS can register) |
| GET/PATCH | `/customers/:id` | scoped |
| GET | `/customers/:id/orders`, `/reservations`, `/interactions` | scoped |
| POST | `/customers/:id/interactions` | SA · BA · SS |
| GET | `/customers/lookup?phone=` | staff (finds the central identity before registering a duplicate) |
| GET/POST/PATCH/DELETE | `/customer-segments` | SA · BA |
| POST | `/enquiries` | P (web form, rate-limited) · staff (log WhatsApp, phone or walk-in enquiries) |
| GET/PATCH | `/enquiries`, `/enquiries/:id` | scoped staff |
| POST | `/enquiries/:id/convert` | staff → creates a reservation or order |

### 4.7 Cart and checkout (`/cart`, `/checkout`)
| Method | Path | Access |
|---|---|---|
| GET | `/cart` | C or guest (`guestToken` cookie) |
| POST/PATCH/DELETE | `/cart/items[/:itemId]` | C / guest |
| PUT | `/cart/branch` | select the fulfilment branch (returns per-item availability and alternative branches) |
| POST | `/cart/merge` | C (merge the guest cart after login) |
| POST | `/checkout/quote` | C / guest: server-computed totals, delivery fee, promotion |
| POST | `/checkout` | C / guest (if enabled): creates the order in a transaction and holds stock. For Paystack it returns `authorization_url` |

### 4.8 Orders (`/orders`)
| Method | Path | Access |
|---|---|---|
| GET | `/orders` | SA · BA · SS (own branch; SS sees own transactions unless permitted) · C (own) |
| GET | `/orders/:ref` | scoped / own |
| GET | `/orders/track/:ref?phone=` | P (minimal tracking info; phone must match) |
| POST | `/orders` | SS · BA (staff-created / in-store orders) |
| POST | `/orders/:id/status` | BA · SS (permitted transitions only) · SA |
| POST | `/orders/:id/cancel` | C (only while `pending`) · staff |
| GET | `/orders/:id/receipt` | own / scoped (HTML or PDF receipt) |

### 4.9 Reservations (`/reservations`)
| Method | Path | Access |
|---|---|---|
| POST | `/reservations` | P/C (contact details required for guests) · SS (on behalf of a customer) |
| GET | `/reservations` | scoped staff · C (own) |
| GET | `/reservations/:ref` | scoped / own / P with phone match |
| POST | `/reservations/:id/confirm`, `/reject` | BA · SS (if permitted) |
| POST | `/reservations/:id/cancel` | C (own) · staff |
| POST | `/reservations/:id/convert` | staff → creates an order and moves the stock hold across |

### 4.10 Payments (`/payments`, `/webhooks`)
| Method | Path | Access |
|---|---|---|
| POST | `/payments/paystack/initialize` | C / guest (for an existing unpaid order) |
| GET | `/payments/paystack/verify/:reference` | C / guest. The server calls the Paystack Verify API; the frontend result is never trusted |
| POST | `/webhooks/paystack` | Paystack only (HMAC-SHA512 signature, IP allow-list, idempotent) |
| POST | `/payments` | BA · SS: record a cash, transfer or POS payment (audited; a transfer needs a reference) |
| POST | `/payments/:id/confirm` | BA (confirms a bank transfer received) |
| GET | `/payments`, `/payments/:id` | scoped |
| POST | `/payments/:id/refunds` | BA · SA (Paystack Refund API or manual) |
| GET | `/payments/:id/receipt` | scoped / own |

### 4.11 Delivery (`/deliveries`, `/delivery-zones`)
| Method | Path | Access |
|---|---|---|
| GET | `/delivery-zones?branch=` | P |
| POST/PATCH | `/delivery-zones[/:id]` | SA · BA (own branch) |
| GET | `/deliveries` | scoped |
| POST | `/deliveries/:id/assign`, `/status` | BA · SS |

### 4.12 Promotions (`/promotions`)
GET (P: active public promotions; SA: all) · POST/PATCH/deactivate (SA) · POST `/promotions/validate` (C / guest, also applied at checkout quote).

### 4.13 WhatsApp
| Method | Path | Access |
|---|---|---|
| GET | `/whatsapp/link?context=product\|reservation\|order&id=&branch=` | P: returns a `wa.me` URL with a pre-filled message for the branch's WhatsApp number |
| POST | `/whatsapp/click` | P: records an **intent** (analytics only, labelled "link opened", never "delivered") |
| POST | `/webhooks/whatsapp` | Meta (only when the Cloud API is configured; verify token and signature) |

Automated WhatsApp notifications use the notifications module's `WhatsAppChannel`. It is disabled unless `WHATSAPP_*` environment variables are set, and it records a message as delivered **only** when a Meta status webhook says so.

### 4.14 Notifications (`/notifications`)
GET `/notifications` (own) · POST `/notifications/:id/read` · POST `/notifications/read-all` · GET `/notifications/unread-count`. Email templates cover order, reservation, payment, password reset, low stock and transfers.

### 4.15 Analytics and reports (`/analytics`, `/reports`)
| Method | Path | Access |
|---|---|---|
| GET | `/analytics/overview` | SA (company-wide KPIs: branches, products, customers, orders, reservations, revenue, inventory value) |
| GET | `/analytics/branches/performance` | SA |
| GET | `/analytics/branch/:id/overview` | SA · BA (own) |
| GET | `/analytics/sales?from&to&branch&groupBy=day\|week\|month` | scoped |
| GET | `/analytics/top-products`, `/low-stock`, `/recent-transactions` | scoped |
| GET | `/reports/sales`, `/reports/inventory`, `/reports/customers`, `/reports/payments` | scoped; `?format=csv` export |

### 4.16 Settings and audit
GET/PATCH `/settings` (P: public subset · SA: all) · GET `/audit-logs` (SA all; BA own branch, read-only) · GET `/audit-logs/logins` (SA).

### 4.17 System
GET `/health` (liveness) · GET `/health/ready` (DB check) · GET `/api/docs` (Swagger UI; protected in production).

---

## 5. Development Roadmap

Each phase ends with: all tests green, a typecheck and lint pass, an updated API docs page, a phase report (completed features, test results, outstanding work), and a pause for your review.

### Phase 1: Foundation
1. Monorepo, TypeScript, ESLint/Prettier, CI workflow, Docker Compose (Mongo replica set and Mailpit).
2. API core: env validation, logger, DB connection, error handling, response envelope, request ID, security middleware, rate limits, OpenAPI registry, transaction helper, counters, audit service, outbox skeleton.
3. `@mb/shared`: enums, permissions, Zod schemas.
4. Auth: register, login, refresh rotation with reuse detection, logout, password reset by email, sessions, login activity.
5. Roles and permissions, `authorize()`, `resolveBranchScope()`, scoped repository base.
6. Branch module (CRUD, hours, settings), user and staff management, branch assignment, cross-branch grants.
7. Web: design tokens, core UI kit (Button, Input, Form, DataTable, Dialog, Toast, Skeleton, EmptyState), auth pages, guarded admin shell with a role-aware sidebar, Branches and Staff screens.
8. Seed script: 2 Kano branches, 1 Abuja branch, super admin, branch admins, sales staff.
- **Tests:** auth flows, token reuse, rate limits, **branch isolation matrix** (every role against every branch-scoped endpoint: own branch versus another branch).

### Phase 2: Business management ✅
Implementation notes: stock adjustments use the statuses `pending → applied | rejected` (applying happens on approval). Corrections within the company threshold (default 10 units per line) by someone who may approve are applied at once. Branch-scoped staff can list every active branch (public fields only) to pick a transfer partner.

Categories (tree), brands, products with variants and image upload, per-branch inventory, stock in/out, the movement ledger, low-stock detection, adjustments with approval, the inter-branch transfer workflow, customers/CRM (lookup and de-duplication by phone, interactions, segments), enquiries. Admin screens for each.
- **Tests:** concurrent stock operations (parallel decrements never go negative), transfer state machine, adjustment approval rules, CRM scoping.

### Phase 3: E-commerce ✅
Implementation notes: checkout creates real orders (status `pending`) and holds stock with `reservation_hold` movements, so the Order model and its cancel path (which releases stock) were built here. Confirm, prepare, hand-over and payments remain Phase 4. Online card payment (Paystack) is Phase 4; checkout offers pay at branch, pay on delivery and bank transfer. One order comes from one branch (the cart has a single branch). Only one promotion applies per order: the entered code, or the best automatic promotion.

Storefront (home, shop, categories, product details with branch availability and alternative-branch suggestions, search, branches, about, contact), SEO (metadata, sitemap, structured data, ISR), customer account, guest and user cart with merge, branch selection, checkout quote (promotions, delivery zones), checkout (pickup and delivery, guest checkout).
- **Tests:** search and filter, price integrity (client-supplied prices ignored), availability exposure (no exact counts shown publicly), Playwright for browse → cart → checkout.

### Phase 4: Transactions ✅
Implementation notes: completing an order requires it to be fully paid; stock moves from held to sold when a pickup completes or a delivery is dispatched. A returned delivery cancels the order and restocks it. Online orders the branch never confirms are cancelled after a configurable time (default 48 h). Paid-in-full online orders confirm themselves. Bank transfers recorded by sales staff wait for a branch admin. Card refunds are pending until Paystack confirms them by webhook. The background jobs use a MongoDB lease, so several API instances are safe.

Reservations (hold, confirm, reject, expiry job, convert), the order state machine and status history, staff-created orders, Paystack (initialize, verify, webhook, refunds), manual payments, receipts, outstanding balances, deliveries and assignment, the WhatsApp link builder, enquiry logging, the optional Cloud API channel, the notification worker (in-app and email).
- **Tests:** oversell race (N parallel checkouts for the last unit), webhook signature and idempotency, forged frontend "success" rejected, reservation expiry releasing stock, illegal status transitions rejected.

### Phase 5: Analytics ✅
Implementation notes: one analytics module (`modules/analytics`) resolves the caller's branch scope once and every aggregation filters by it. Outstanding balance counts accepted orders not yet completed: completion needs full payment, so a later partial refund is a return, not a debt. Units sold and best sellers use completed orders; gross sales uses confirmation date. Inventory value uses the product cost price (variants share it); lines without a cost price are counted and reported. New indexes: orders by `confirmedAt` and `completedAt`, payments by `status, verifiedAt` and `refunds.at`, customers by `createdAt`. CSV exports stream from a cursor, cap at 50,000 rows, guard against spreadsheet formulas and are audited. The dashboard and charts are hand-built SVG (no chart library) with a hover or keyboard readout and a table view.

Super admin dashboard, branch dashboard, sales, inventory, customer and payment reports, CSV export, charts. Aggregations are backed by indexes and use the defined revenue metrics.
- **Tests:** report figures reconciled against seeded fixtures; branch admins never see other branches' figures.

### Phase 6: Quality and deployment
Security review (OWASP API Top 10 checklist, dependency audit, header checks), performance (indexes, `explain` on heavy queries, image optimisation, Lighthouse ≥ 90 mobile on storefront pages), full end-to-end suite, accessibility checks (axe), `DEPLOYMENT.md` (Atlas, API on Render/Railway/a VPS with PM2 or Docker, web on Vercel, environment variables, backups, Paystack and WhatsApp webhook setup), and a production seed or bootstrap.

---

## 6. Decisions requiring approval

| # | Decision | Proposed default |
|---|---|---|
| D1 | **OrderItem** is an embedded subdocument schema in `Order` rather than a separate collection (the same applies to Cart items). | Embedded. Orders are written and read atomically, and items are immutable snapshots. Reports use `$unwind`. A separate collection is possible if you need it. |
| D2 | Reservations **hold stock at submission** (pending), not only at confirmation. | Hold at submission, with a short pending expiry (default 24 h) and a confirmed hold of 48 h. Both are configurable. |
| D3 | Guest checkout | Enabled. A guest gets a Customer record keyed by phone, and orders are tracked by reference and phone. |
| D4 | Public stock display | Show "In stock", "Low stock" and "Out of stock" per branch, never exact quantities. |
| D5 | Hosting | MongoDB Atlas; API on Render or Railway (or a VPS with Docker); web on Vercel. |
| D6 | Media storage | Cloudinary (free tier is enough to start). |
| D7 | Email | Any SMTP provider (e.g. Brevo, Resend or Zoho); Mailpit in development. |
| D8 | Sales-staff visibility of orders | Their own transactions by default. A branch admin can grant "view all branch orders". |
| D9 | VAT | Prices are VAT-inclusive, with a company setting to show VAT on receipts. |
