# Deployment

> Status: covers Phases 1–4, including the Paystack and WhatsApp webhooks. Phase 6 adds backups, monitoring and scaling.

## Topology (decision D5)

```
Browser ──HTTPS──▶ Web (Vercel, Next.js) ──/api/* rewrite──▶ API (Render / Railway / VPS) ──▶ MongoDB Atlas (replica set)
                                                                     └──▶ SMTP provider
```

The browser only ever talks to the web domain. Next.js forwards `/api/*` to the API, so the refresh cookie is first-party.

## 1. Database: MongoDB Atlas

1. Create a cluster. Every Atlas tier is a replica set, which the API requires.
2. Create a database user with readWrite access on the `mudassir` database.
3. Allow the API host's outbound IP in Network Access. If the host has no static IP, use the provider's documented range.
4. Copy the connection string: `mongodb+srv://USER:PASS@cluster.xxxxx.mongodb.net/mudassir?retryWrites=true&w=majority`.

## 2. API

Build and start:

```bash
npm ci
npm run build -w @mb/api          # bundles to apps/api/dist
npm start -w @mb/api              # node dist/server.js
```

Environment (see [apps/api/.env.example](../apps/api/.env.example)):

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | provided by the host |
| `MONGODB_URI` | Atlas connection string |
| `WEB_URL` | `https://www.your-domain.ng` |
| `JWT_ACCESS_SECRET` | 48+ random bytes, unique per environment. **Never reuse the development value.** |
| `TRUST_PROXY` | `1` behind Render, Railway, Nginx or a load balancer |
| `SMTP_URL`, `MAIL_FROM` | your email provider |
| `CLOUDINARY_URL` | **required**: `cloudinary://<api_key>:<api_secret>@<cloud_name>` from the Cloudinary dashboard. The API will not start in production without it. |
| `CLOUDINARY_FOLDER` | e.g. `mudassir` (use `mudassir-staging` for staging so images do not mix) |
| `PAYSTACK_SECRET_KEY` | `sk_live_…` (use `sk_test_…` on staging). Set the webhook URL in Paystack to `https://<api-domain>/api/v1/webhooks/paystack`. |
| `WHATSAPP_*` | Optional. Meta Cloud API token, phone number id, app secret and verify token; webhook `https://<api-domain>/api/v1/webhooks/whatsapp`. Templates `order_update` and `reservation_update` must be approved in WhatsApp Manager with three body parameters. |
| `API_DOCS_ENABLED` | `false` (or leave unset) unless docs must be public |

Health checks: `GET /health` (liveness) and `GET /health/ready` (database connected).

The rate limiter keeps counts in memory, which is correct for **one API instance**. Before scaling to several instances, switch to a shared store (noted in `core/middleware/rateLimit.ts`).

### First Super Admin

```bash
SUPER_ADMIN_NAME="Owner Name" SUPER_ADMIN_EMAIL="owner@your-domain.ng" \
SUPER_ADMIN_PHONE="0803..." SUPER_ADMIN_PASSWORD="a-strong-temporary-password1" \
node apps/api/dist/scripts/create-super-admin.js
```

The owner signs in and must choose a new password straight away. Branches and staff are then created from the admin. **Never run `seed` against production**; it refuses unless forced.

## 3. Web app (Vercel)

- Root directory: `apps/web`. Install command: `npm ci` (run at the repository root). Build command: `npm run build`.
- Environment: `API_URL=https://api.your-domain.ng` (server-side only) and `NEXT_PUBLIC_SITE_URL=https://www.your-domain.ng`.

## 4. Release checklist

- [ ] `npm run lint && npm run typecheck && npm test && npm run build` pass (CI does this on every push).
- [ ] Production `JWT_ACCESS_SECRET` set and stored in the host's secret manager.
- [ ] `WEB_URL` matches the real web origin exactly, or every cookie request is rejected with `ORIGIN_NOT_ALLOWED`.
- [ ] Atlas backups enabled.
- [ ] Cloudinary: set an upload size limit and enable "Strict transformations" if only the named sizes should be generated.
- [ ] Seed branch details replaced with real addresses and phone numbers.
- [ ] Paystack: live secret key set and webhook URL saved in the Paystack dashboard. Make one small real payment and confirm it shows as paid.
- [ ] Bank transfer details entered in **Admin → Settings** if customers can pay by transfer.
- [ ] WhatsApp (optional): templates approved, webhook verified in the Meta dashboard.
- [ ] Only one process runs the background jobs, or every instance shares the same database (the jobs use a database lease, so either is safe).
