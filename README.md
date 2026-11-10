# Mudassir & Brothers

Multi-branch retail and e-commerce platform for Mudassir & Brothers (Kano and Abuja). It covers the head office, the branches, staff and customers.

| Part | Path | Stack |
|---|---|---|
| Web app (storefront and admin dashboards) | [apps/web](apps/web) | Next.js 16, React 19, Tailwind CSS 4, TanStack Query |
| REST API | [apps/api](apps/api) | Node.js, Express 5, MongoDB (Mongoose 9), Zod 4 |
| Shared contracts | [packages/shared](packages/shared) | Zod schemas, enums, permissions and DTO types used by both apps |

Design and roadmap: [docs/FOUNDATION.md](docs/FOUNDATION.md) · API conventions: [docs/API.md](docs/API.md) · Deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Requirements

- Node.js 22.12 or later, npm 10 or later
- MongoDB **running as a replica set** (transactions are required). Use one of:
  - `npm run db:dev`: no Docker needed; downloads MongoDB on first run and keeps data in `apps/api/.data`
  - `docker compose up mongo mailpit`
  - MongoDB Atlas

## First-time setup

```bash
npm install
cp apps/api/.env.example apps/api/.env        # then set JWT_ACCESS_SECRET (see the comment in the file)
cp apps/web/.env.example apps/web/.env.local

npm run db:dev        # terminal 1: local MongoDB replica set
npm run seed          # once: branches, staff and a customer for development
npm run dev           # terminal 2: API on http://localhost:4100, web on http://localhost:3000
```

API documentation (Swagger UI) runs at http://localhost:4100/api/docs.

### Development accounts (from `npm run seed`)

All seed accounts use the password `Password123` (or `SEED_PASSWORD`).

| Role | Sign in with | Branch |
|---|---|---|
| Super Admin | owner@mb.test | All |
| Branch Admin | admin.kan01@mb.test · admin.kan02@mb.test · admin.abj01@mb.test | KAN01 · KAN02 · ABJ01 |
| Sales Staff | sales.kan01@mb.test · sales.kan02@mb.test · sales.abj01@mb.test | KAN01 · KAN02 · ABJ01 |
| Customer | customer@mb.test | (prefers KAN01) |

Seed branch addresses and phone numbers are placeholders. Replace them in **Admin → Branches** before going live.

## Common commands

| Command | What it does |
|---|---|
| `npm run dev` | API and web app with hot reload |
| `npm test` | Every test suite (shared unit tests, API integration tests against a real in-memory MongoDB replica set, web unit tests) |
| `npm run lint` · `npm run typecheck` | Static checks |
| `npm run build` | Production builds of the API (`apps/api/dist`) and the web app |
| `npm run seed -- --reset` | Wipe the development database and seed it again |

> **Windows note:** npm runs scripts through `cmd.exe`, which breaks when the folder path contains `&` (such as `M&B`). Either clone into a folder without `&` (for example `M-B`), or run `npm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"`.

## Project status

Built in phases (see the roadmap in [docs/FOUNDATION.md](docs/FOUNDATION.md#5-development-roadmap)).

- [x] **Phase 1: Foundation.** Authentication, roles and permissions, branch isolation, branches, staff, company settings, activity log, admin shell, public branch pages
- [ ] Phase 2: Products, categories, brands, per-branch inventory, stock transfers, CRM
- [ ] Phase 3: Storefront catalogue, search, cart, checkout
- [ ] Phase 4: Reservations, orders, payments (Paystack), delivery, WhatsApp
- [ ] Phase 5: Dashboards and reports
- [ ] Phase 6: Hardening, end-to-end tests, production deployment
