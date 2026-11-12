# Deployment

Covers all six phases. Two supported setups:

- **A. Managed (recommended to start):** MongoDB Atlas + API on Render (or Railway) + web app on Vercel.
- **B. One VPS:** MongoDB Atlas + API and web in Docker behind Caddy (automatic HTTPS), or with PM2 and no Docker.

```
Browser ──HTTPS──▶ Web (Next.js) ──/api/* proxy──▶ API (Express) ──▶ MongoDB Atlas (replica set)
                                                     ├──▶ Cloudinary (images)     ├──▶ SMTP (email)
                                                     └──▶ Paystack, WhatsApp Cloud API (optional)
```

The browser only talks to the web domain. Next.js forwards `/api/*` to the API, so the refresh cookie is first-party and the API needs no public CORS.

## 1. Database: MongoDB Atlas

1. Create a cluster in a region close to Nigeria (e.g. Frankfurt or Johannesburg). Every Atlas tier is a replica set, which the API requires for transactions.
2. Create a database user with `readWrite` on the `mudassir` database only.
3. Network Access: allow only the API host's outbound IP (or the provider's published range).
4. Copy the connection string: `mongodb+srv://USER:PASS@cluster.xxxxx.mongodb.net/mudassir?retryWrites=true&w=majority`.
5. **Backups:** on M10 and above, turn on Cloud Backup with continuous (point-in-time) restore and keep daily snapshots for at least 7 days. On the free and shared tiers, run the nightly `mongodump` below.

## 2. Environment variables

API (`apps/api/.env.example` documents each one; `deploy/api.env.example` is a production template):

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Atlas connection string |
| `WEB_URL` | `https://www.your-domain.ng`. Must be `https://`; it is also the only origin allowed to send cookies. |
| `JWT_ACCESS_SECRET` | 48+ random characters, unique to production: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `TRUST_PROXY` | `1` behind Render, Railway, Caddy, Nginx or a load balancer |
| `SMTP_URL`, `MAIL_FROM` | your email provider (password-reset and order emails) |
| `CLOUDINARY_URL` | **required**: `cloudinary://<key>:<secret>@<cloud>` |
| `CLOUDINARY_FOLDER` | e.g. `mudassir` (use `mudassir-staging` for staging) |
| `PAYSTACK_SECRET_KEY` | `sk_live_…` (`sk_test_…` on staging). Empty = no card payments. |
| `WHATSAPP_*` | optional; see section 6 |
| `API_DOCS_ENABLED` | leave unset (off in production) |

The API **refuses to start** in production with a weak or example `JWT_ACCESS_SECRET`, a non-HTTPS `WEB_URL`, insecure cookies, or no Cloudinary. The error names the variable to fix.

Web app: `API_URL` (where the API is, server-side only) and `NEXT_PUBLIC_SITE_URL` (the public address, used for links and the sitemap). Nothing secret goes to the web app.

> `API_URL` is fixed into the proxy **at build time**. The API must be deployed and reachable before the web app is built, so storefront pages are generated with real products. Rebuild the web app if the API address changes.

## 3. Every release

```bash
npm ci
npm run lint && npm run typecheck && npm test && npm run build   # CI also runs the end-to-end suite
node apps/api/dist/scripts/bootstrap.js                          # against the production database
```

`bootstrap` is safe to run on every release: it checks the database supports transactions, builds the indexes the new code needs (and removes indexes no longer declared), and makes sure the system roles and settings exist. It never deletes business data. Run it **before** switching traffic to the new API (Render does this with `preDeployCommand`).

### First release only: the owner's account

```bash
SUPER_ADMIN_NAME="Owner Name" SUPER_ADMIN_EMAIL="owner@your-domain.ng" \
SUPER_ADMIN_PHONE="0803..." SUPER_ADMIN_PASSWORD="a-strong-temporary-password1" \
node apps/api/dist/scripts/create-super-admin.js
```

The owner signs in, must choose a new password, then creates the real branches and staff in the admin. **Never run `seed` against production**; it refuses unless forced.

## 4A. Managed setup: Render + Vercel

**API on Render.** `render.yaml` at the repository root is a Blueprint: in Render choose *New → Blueprint*, pick the repository, and enter the secret values when asked. It builds `apps/api/Dockerfile`, runs `bootstrap` before each deploy, checks `/health/ready`, and generates `JWT_ACCESS_SECRET`. Give the service a custom domain such as `api.your-domain.ng`. Railway works the same way with the same Dockerfile and variables.

**Web on Vercel.** Import the repository, set Root Directory to `apps/web`, and leave the install and build commands as detected (Vercel installs from the repository root). Set `API_URL=https://api.your-domain.ng` and `NEXT_PUBLIC_SITE_URL=https://www.your-domain.ng`. Add your domain; Vercel handles HTTPS.

## 4B. One VPS (Ubuntu 24.04, 2 GB RAM or more)

Point `your-domain.ng` and `www.your-domain.ng` at the server, open ports 80 and 443 only, then:

```bash
git clone <repo> mudassir && cd mudassir
cp deploy/api.env.example deploy/api.env && nano deploy/api.env   # real values; chmod 600
export DOMAIN=your-domain.ng
docker compose -f deploy/docker-compose.prod.yml build
docker compose -f deploy/docker-compose.prod.yml run --rm api node dist/scripts/bootstrap.js
docker compose -f deploy/docker-compose.prod.yml up -d
```

Caddy obtains and renews the certificate and redirects the bare domain to `www`. The API container runs as a non-root user on a read-only filesystem and is not exposed to the internet.

*Without Docker:* install Node 22, build as in section 3, put the API settings in `apps/api/.env` (`chmod 600`), build the web app with `API_URL=http://127.0.0.1:4100`, and run `pm2 start deploy/ecosystem.config.cjs`. Put Caddy or Nginx in front of port 3000 for HTTPS.

**Updating:** `git pull`, rebuild, run `bootstrap`, then `up -d` (Docker) or `pm2 reload all`.

## 5. Payments: Paystack

1. In the Paystack dashboard → Settings → API Keys & Webhooks, copy the secret key into `PAYSTACK_SECRET_KEY`.
2. Set the webhook URL to `https://www.your-domain.ng/api/v1/webhooks/paystack` (or the API's own domain in the managed setup).
3. Nothing else to set: each payment tells Paystack to return the customer to `WEB_URL/payment/callback`.
4. Make one small real payment and check it appears as **Received** under Admin → Payments and on the order.

An order is marked paid only after the API verifies the transaction with Paystack or receives Paystack's signed webhook, with the amount and currency matching.

## 6. WhatsApp Cloud API (optional)

Customers can always tap "WhatsApp the branch" without this. To send automatic order and reservation updates:

1. In Meta Business, create an app with WhatsApp, add the business number, and copy the permanent token, phone number id and app secret into `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_APP_SECRET`. Choose any random `WHATSAPP_VERIFY_TOKEN`.
2. Webhook: `https://www.your-domain.ng/api/v1/webhooks/whatsapp` with that verify token; subscribe to `messages`.
3. Get two templates approved with three body parameters each: `order_update` and `reservation_update` (names can be changed with `WHATSAPP_TEMPLATE_*`).

A message is shown as *delivered* only when Meta's webhook says so.

## 7. Monitoring and logs

- **Uptime:** point a monitor (UptimeRobot, Better Stack or similar) at `https://www.your-domain.ng/login` and the API's `/health/ready` every minute, with SMS or WhatsApp alerts.
- **Logs:** the API writes JSON logs to stdout with a request id on every line (also returned as the `X-Request-Id` header and in every error response, so a failed request can be found in the logs). Render and Vercel keep them; on a VPS, `docker compose logs` (rotation is configured in the Compose file) or `pm2 logs` (add rotation with `pm2 install pm2-logrotate`).
- **Atlas:** turn on alerts for connections, disk use and replication lag.
- **Business checks:** the admin dashboard's *Needs attention* list shows stuck orders, unchecked transfers and stock alerts.

## 8. Backups and restore

- **Atlas M10+:** continuous backup (above). Restore a snapshot to a *new* cluster, check it, then point `MONGODB_URI` at it.
- **Shared tiers or extra copies:** a nightly dump from any machine with the MongoDB Database Tools:

  ```bash
  mongodump --uri "$MONGODB_URI" --gzip --archive="mudassir-$(date +%F).gz"
  # restore into an empty database:
  mongorestore --uri "$RESTORE_URI" --gzip --archive=mudassir-2026-11-12.gz --nsInclude 'mudassir.*'
  ```

  Keep at least 14 days, store them off the server (for example in a private bucket), and **test a restore every quarter**.
- Product images live in Cloudinary, which keeps its own backups; the database stores their addresses.

## 9. Rolling back

- **Vercel:** promote the previous deployment (one click). **Render:** redeploy the previous build.
- **Docker:** `git checkout <previous tag>`, rebuild, `up -d`. **PM2:** same, then `pm2 reload all`.
- Database changes are additive (new fields and indexes), so the previous version runs against the newer database. If a release ever needs a data migration, it will say so in its notes, with a backup taken first.

## 10. Scaling

One API instance handles a busy multi-branch shop. Before adding more instances:

1. Move the rate limiter's counters to Redis (`core/middleware/rateLimit.ts`); in-memory counts are per process.
2. Background jobs already use a database lease, so several instances never run the same job twice.
3. The outbox is safe with several workers (tested).

## 11. Go-live checklist

- [ ] CI green: lint, typecheck, unit and API tests, builds, end-to-end and accessibility suite, production dependency audit.
- [ ] Production secrets set in the host's secret manager (never in the repository); `JWT_ACCESS_SECRET` unique to production.
- [ ] `WEB_URL` matches the real web address exactly (otherwise cookie requests fail with `ORIGIN_NOT_ALLOWED`).
- [ ] `bootstrap` run against production; owner account created and password changed.
- [ ] Real branch addresses, phone numbers, WhatsApp numbers and opening hours entered; no seed data in production.
- [ ] Atlas backups on (or nightly dump scheduled), and one restore tested.
- [ ] Uptime monitors and alerts configured.
- [ ] Cloudinary: upload size limit set.
- [ ] Paystack: live key, webhook and callback set; one real payment made and seen as Received.
- [ ] Bank transfer details entered in **Admin → Settings** if customers can pay by transfer.
- [ ] WhatsApp (optional): templates approved and webhook verified.
- [ ] `docs/SECURITY.md` residual risks reviewed and accepted.
