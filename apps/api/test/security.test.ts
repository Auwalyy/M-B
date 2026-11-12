import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { envSchema } from '../src/config/env';
import { Order } from '../src/modules/commerce/commerce.models';
import { User } from '../src/modules/users/user.model';
import { as, makeApp, makeCatalog, makeWorld, stockIn } from './helpers';

/**
 * Checks mapped to the OWASP API Security Top 10 (2023). See docs/SECURITY.md for the full review;
 * many items are also covered by the module suites (isolation, auth, platform, transactions).
 */
const app = makeApp();
let world: Awaited<ReturnType<typeof makeWorld>>;
let cat: Awaited<ReturnType<typeof makeCatalog>>;
let KANO: string;

async function customer(phone: string, extra: Record<string, unknown> = {}) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/register').send({ fullName: `Buyer ${phone.slice(-3)}`, phone, password: 'Buyer12345', ...extra });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return { agent, token: res.body.data.accessToken as string, user: res.body.data.user };
}

async function placeOrder(c: Awaited<ReturnType<typeof customer>>, body: Record<string, unknown> = {}) {
  const auth = { Authorization: `Bearer ${c.token}` };
  await c.agent.put('/api/v1/cart/items').set(auth).send({ product: cat.tv.id, quantity: 1 });
  await c.agent.put('/api/v1/cart/branch').set(auth).send({ branch: KANO });
  const res = await c.agent.post('/api/v1/checkout').set(auth).send({
    fulfilment: 'pickup', paymentMethod: 'pay_on_pickup', idempotencyKey: randomUUID(), contact: { fullName: 'Buyer', phone: c.user.phone }, ...body,
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.data;
}

beforeEach(async () => {
  world = await makeWorld(app);
  cat = await makeCatalog(app, world.sessions.superAdmin);
  KANO = world.branches.kano._id.toString();
  await stockIn(app, world.sessions.kanoAdmin, KANO, cat.tv.id, 5);
});

describe('API1 broken object level authorisation', () => {
  it("a customer cannot read, cancel or print another customer's order", async () => {
    const alice = await customer('08071110001');
    const bob = await customer('08071110002');
    const order = await placeOrder(alice);
    const asBob = (r: request.Test) => r.set('Authorization', `Bearer ${bob.token}`);
    expect((await asBob(request(app).get(`/api/v1/orders/mine/${order.reference}`))).status).toBe(404);
    expect((await asBob(request(app).get(`/api/v1/orders/mine/${order.reference}/receipt`))).status).toBe(404);
    expect((await asBob(request(app).post(`/api/v1/orders/mine/${order.reference}/cancel`)).send({})).status).toBe(404);
    expect((await asBob(request(app).get('/api/v1/orders/mine'))).body.data).toHaveLength(0);
    // Public tracking needs the phone that placed the order.
    expect((await request(app).get('/api/v1/orders/track').query({ reference: order.reference, phone: bob.user.phone })).status).toBe(404);
    expect((await Order.findById(order.id).lean())!.status).toBe('pending');
  });
});

describe('API3 broken object property level authorisation', () => {
  it('ignores role, status and permission fields smuggled into sign-up and profile updates', async () => {
    const c = await customer('08071110003', { role: 'SUPER_ADMIN', roleKey: 'SUPER_ADMIN', status: 'active', permissions: ['settings:update'], branches: [KANO] });
    expect(c.user.role).toBe('CUSTOMER');
    const patch = await request(app).patch('/api/v1/auth/me').set('Authorization', `Bearer ${c.token}`).send({ fullName: 'Still A Customer', roleKey: 'SUPER_ADMIN', mustChangePassword: false });
    expect(patch.status).toBeLessThan(500);
    const user = await User.findById(c.user.id).lean();
    expect(user).toMatchObject({ roleKey: 'CUSTOMER', branches: [] });
  });

  it('never shows the public exact stock counts or cost prices', async () => {
    for (const url of [`/api/v1/products/${cat.tv.slug}`, `/api/v1/products/${cat.tv.slug}/availability`, '/api/v1/products']) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(200);
      expect(JSON.stringify(res.body), url).not.toMatch(/costPrice|"quantity"|"reserved"|"available"/);
    }
  });
});

describe('API4 unrestricted resource consumption', () => {
  it('caps page sizes, line quantities and report ranges', async () => {
    expect((await as(app, world.sessions.superAdmin).get('/api/v1/orders?limit=1000')).status).toBe(422);
    expect((await request(app).put('/api/v1/cart/items').send({ product: cat.tv.id, quantity: 100_000 })).status).toBe(422);
    expect((await as(app, world.sessions.superAdmin).get('/api/v1/reports/sales?from=2000-01-01&to=2026-01-01')).status).toBe(422);
  });
});

describe('API5 broken function level authorisation', () => {
  it('customers and sales staff cannot reach management functions', async () => {
    const c = await customer('08071110004');
    const cust = (method: 'get' | 'post' | 'patch', url: string) => request(app)[method](url).set('Authorization', `Bearer ${c.token}`).send({});
    for (const [method, url] of [
      ['get', '/api/v1/users'], ['get', '/api/v1/orders'], ['get', '/api/v1/customers'], ['get', '/api/v1/inventory'],
      ['get', '/api/v1/analytics/overview'], ['get', '/api/v1/audit-logs'], ['patch', '/api/v1/settings'], ['post', '/api/v1/branches'],
    ] as const) {
      expect((await cust(method, url)).status, `${method} ${url}`).toBe(403);
    }
    const sales = as(app, world.sessions.kanoSales);
    expect((await sales.post('/api/v1/branches', {})).status).toBe(403);
    expect((await sales.patch('/api/v1/settings', { companyName: 'Hacked' })).status).toBe(403);
    expect((await sales.get('/api/v1/roles')).status).toBe(403);
    expect((await sales.get('/api/v1/reports/payments')).status).toBe(403);
  });
});

describe('API6 unrestricted access to sensitive business flows', () => {
  it('prices checkout on the server, ignoring prices and totals sent by the browser', async () => {
    const c = await customer('08071110005');
    const order = await placeOrder(c, { total: 100, subtotal: 100, items: [{ product: cat.tv.id, quantity: 1, unitPrice: 1 }], discountTotal: 999_999_999 });
    expect(order.total).toBe(60_000_000);
    expect(order.paymentStatus).toBe('unpaid');
  });
});

describe('API8 security misconfiguration', () => {
  it('only allows the web app origin to read API responses cross-origin', async () => {
    const evil = await request(app).get('/api/v1/branches').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const ours = await request(app).get('/api/v1/branches').set('Origin', 'http://localhost:3000');
    expect(ours.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('refuses to start production with development settings', () => {
    const base = { NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://u:p@cluster.example/mudassir', WEB_URL: 'https://www.example.ng', JWT_ACCESS_SECRET: 'x'.repeat(64) };
    expect(envSchema.safeParse(base).success).toBe(true);
    const fail = (patch: Record<string, string>) => envSchema.safeParse({ ...base, ...patch }).success;
    expect(fail({ JWT_ACCESS_SECRET: 'change-me-to-a-long-random-string-of-at-least-32-chars-xxxxxxxx' })).toBe(false);
    expect(fail({ JWT_ACCESS_SECRET: 'y'.repeat(40) })).toBe(false);
    expect(fail({ WEB_URL: 'http://www.example.ng' })).toBe(false);
    expect(fail({ COOKIE_SECURE: 'false' })).toBe(false);
  });
});
