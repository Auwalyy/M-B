import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { processOutboxBatch } from '../src/core/events/outbox';
import { testMailbox } from '../src/core/mail/mailer';
import { Order, Promotion } from '../src/modules/commerce/commerce.models';
import { Customer } from '../src/modules/customers/customer.model';
import { Inventory } from '../src/modules/inventory/inventory.models';
import { Setting } from '../src/modules/settings/setting.model';
import { as, login, makeApp, makeCatalog, makeWorld, stockIn } from './helpers';

const app = makeApp();
let world: Awaited<ReturnType<typeof makeWorld>>;
let cat: Awaited<ReturnType<typeof makeCatalog>>;
let KANO: string;
let ABUJA: string;

beforeEach(async () => {
  world = await makeWorld(app);
  cat = await makeCatalog(app, world.sessions.superAdmin);
  KANO = world.branches.kano._id.toString();
  ABUJA = world.branches.abuja._id.toString();
  await stockIn(app, world.sessions.kanoAdmin, KANO, cat.tv.id, 3);
  await stockIn(app, world.sessions.kanoAdmin, KANO, cat.kaftan.id, 10, cat.kaftan.variants[0].id);
});

const contact = { fullName: 'Guest Buyer', phone: '08061234567', email: 'guest@example.com' };
const checkoutBody = (extra: Record<string, unknown> = {}) => ({
  fulfilment: 'pickup',
  paymentMethod: 'pay_on_pickup',
  contact,
  idempotencyKey: randomUUID(),
  ...extra,
});

/** A guest shopper with a cookie jar and a cart at Kano. */
async function guestWithCart(items: { product: string; variantId?: string | null; quantity: number }[], branch = KANO) {
  const agent = request.agent(app);
  for (const i of items) {
    const r = await agent.put('/api/v1/cart/items').send({ variantId: null, ...i });
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  }
  await agent.put('/api/v1/cart/branch').send({ branch });
  return agent;
}

describe('cart', () => {
  it('gives guests a cart cookie and prices lines on the server', async () => {
    const agent = request.agent(app);
    const add = await agent.put('/api/v1/cart/items').send({ product: cat.tv.id, quantity: 2 });
    expect(add.status).toBe(200);
    expect((add.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(/mb_cart=.*HttpOnly/i);
    expect(add.body.data).toMatchObject({ itemCount: 2, subtotal: 120_000_000, lines: [{ unitPrice: 60_000_000, compareAtPrice: 65_000_000, level: null }] });

    const withBranch = await agent.put('/api/v1/cart/branch').send({ branch: KANO });
    expect(withBranch.body.data.lines[0]).toMatchObject({ level: 'low', problem: null });
    expect(withBranch.body.data.branch).toMatchObject({ code: 'KAN01', pickup: true, delivery: true });

    // Another browser does not see this cart.
    expect((await request(app).get('/api/v1/cart')).body.data.lines).toEqual([]);
  });

  it('flags lines the chosen branch cannot supply', async () => {
    const agent = await guestWithCart([{ product: cat.tv.id, quantity: 5 }]);
    expect((await agent.get('/api/v1/cart')).body.data.lines[0].problem).toMatch(/Not enough stock/);
    await agent.put('/api/v1/cart/branch').send({ branch: ABUJA });
    expect((await agent.get('/api/v1/cart')).body.data.lines[0]).toMatchObject({ level: 'out', problem: expect.stringMatching(/Out of stock/) });
  });

  it('requires a valid option for variant products and rejects drafts', async () => {
    const agent = request.agent(app);
    expect((await agent.put('/api/v1/cart/items').send({ product: cat.kaftan.id, quantity: 1 })).status).toBe(400);
    const draft = await as(app, world.sessions.superAdmin).post('/api/v1/products', { name: 'Draft', sku: 'DRF-9', category: cat.tvs.id, price: 100 });
    expect((await agent.put('/api/v1/cart/items').send({ product: draft.body.data.id, quantity: 1 })).status).toBe(404);
  });

  it('merges the guest cart into the account after sign-in', async () => {
    const agent = await guestWithCart([{ product: cat.tv.id, quantity: 1 }]);
    const res = await agent.post('/api/v1/auth/register').send({ fullName: 'New Buyer', phone: '08070001111', password: 'Buyer12345' });
    const token = res.body.data.accessToken;
    const merged = await agent.post('/api/v1/cart/merge').set('Authorization', `Bearer ${token}`);
    expect(merged.body.data).toMatchObject({ itemCount: 1, branch: { code: 'KAN01' } });
    // The account cart now follows the user to any device.
    expect((await request(app).get('/api/v1/cart').set('Authorization', `Bearer ${token}`)).body.data.itemCount).toBe(1);
  });
});

describe('quote', () => {
  it('adds the delivery fee for the chosen area, free above the threshold', async () => {
    const zone = await as(app, world.sessions.kanoAdmin).post('/api/v1/delivery-zones', { branch: KANO, name: 'Kano city', areas: ['Nassarawa', 'Fagge'], fee: 250_000, freeAbove: 100_000_000 });
    expect(zone.status).toBe(201);
    const agent = await guestWithCart([{ product: cat.kaftan.id, variantId: cat.kaftan.variants[0].id, quantity: 1 }]);
    const q = await agent.post('/api/v1/checkout/quote').send({ fulfilment: 'delivery', deliveryZone: zone.body.data.id });
    expect(q.body.data).toMatchObject({ subtotal: 1_500_000, deliveryFee: 250_000, total: 1_750_000, problems: [] });

    await agent.put('/api/v1/cart/items').send({ product: cat.tv.id, quantity: 2 });
    const big = await agent.post('/api/v1/checkout/quote').send({ fulfilment: 'delivery', deliveryZone: zone.body.data.id });
    expect(big.body.data.deliveryFee).toBe(0);
  });

  it('rejects a delivery area belonging to another branch', async () => {
    const zone = await as(app, world.sessions.abujaAdmin).post('/api/v1/delivery-zones', { branch: ABUJA, name: 'Wuse', fee: 300_000 });
    expect((await as(app, world.sessions.kanoAdmin).post('/api/v1/delivery-zones', { branch: ABUJA, name: 'X', fee: 1 })).status).toBe(403);
    const agent = await guestWithCart([{ product: cat.tv.id, quantity: 1 }]);
    const q = await agent.post('/api/v1/checkout/quote').send({ fulfilment: 'delivery', deliveryZone: zone.body.data.id });
    expect(q.body.data.problems).toContain('Choose a delivery area served by this branch.');
  });

  it('applies promo codes by scope and minimum, and explains when it cannot', async () => {
    const sa = as(app, world.sessions.superAdmin);
    const now = Date.now();
    const window = { startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 86_400_000).toISOString() };
    await sa.post('/api/v1/promotions', { name: 'TV week', code: 'TV10', type: 'percentage', value: 10, categories: [cat.tvs.id], maxDiscount: 5_000_000, ...window });
    await sa.post('/api/v1/promotions', { name: 'Big basket', code: 'BIG5K', type: 'fixed_amount', value: 500_000, minOrderAmount: 100_000_000, ...window });

    const agent = await guestWithCart([{ product: cat.tv.id, quantity: 1 }, { product: cat.kaftan.id, variantId: cat.kaftan.variants[0].id, quantity: 1 }]);
    const tv10 = await agent.post('/api/v1/checkout/quote').send({ fulfilment: 'pickup', promoCode: 'tv10' });
    // 10% of the TV (₦600,000) is ₦60,000, capped at ₦50,000; the kaftan is not a TV.
    expect(tv10.body.data).toMatchObject({ discount: 5_000_000, total: 61_500_000 - 5_000_000, promotion: { code: 'TV10' } });

    const min = await agent.post('/api/v1/checkout/quote').send({ fulfilment: 'pickup', promoCode: 'BIG5K' });
    expect(min.body.data).toMatchObject({ discount: 0, promotion: null, promoMessage: expect.stringMatching(/Spend at least/) });
    const unknown = await agent.post('/api/v1/checkout/quote').send({ fulfilment: 'pickup', promoCode: 'NOPE' });
    expect(unknown.body.data.promoMessage).toMatch(/not recognised/);
  });

  it('applies the best automatic promotion without a code', async () => {
    const now = Date.now();
    await Promotion.create([
      { name: 'Free delivery week', type: 'free_delivery', value: 0, startsAt: new Date(now - 1000), endsAt: new Date(now + 86_400_000), createdBy: world.users.superAdmin._id },
    ]);
    const zone = await as(app, world.sessions.kanoAdmin).post('/api/v1/delivery-zones', { branch: KANO, name: 'City', fee: 250_000 });
    const agent = await guestWithCart([{ product: cat.kaftan.id, variantId: cat.kaftan.variants[0].id, quantity: 1 }]);
    const q = await agent.post('/api/v1/checkout/quote').send({ fulfilment: 'delivery', deliveryZone: zone.body.data.id });
    expect(q.body.data).toMatchObject({ deliveryFee: 0, promotion: { name: 'Free delivery week' } });
  });
});

describe('checkout', () => {
  it('places a guest order: holds stock, empties the cart, records the customer, and sends emails', async () => {
    const agent = await guestWithCart([{ product: cat.tv.id, quantity: 2 }]);
    const res = await agent.post('/api/v1/checkout').send(checkoutBody());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      reference: expect.stringMatching(/^ORD-KAN01-\d{6}$/),
      status: 'pending',
      paymentStatus: 'unpaid',
      total: 120_000_000,
      items: [{ sku: 'SAM-TV-001', quantity: 2, unitPrice: 60_000_000 }],
      fulfilment: { method: 'pickup' },
    });
    const inv = await Inventory.findOne({ product: cat.tv.id, branch: KANO }).lean();
    expect(inv).toMatchObject({ quantity: 3, reserved: 2 });
    expect((await agent.get('/api/v1/cart')).body.data.itemCount).toBe(0);
    expect(await Customer.findOne({ phone: '+2348061234567' }).lean()).toMatchObject({ source: 'guest_checkout', email: 'guest@example.com' });

    await processOutboxBatch();
    expect(testMailbox.map((m) => m.to).sort()).toEqual(['admin.kano@test.local', 'guest@example.com']);
  });

  it('a retried submit with the same key returns the same order', async () => {
    const agent = await guestWithCart([{ product: cat.tv.id, quantity: 1 }]);
    const body = checkoutBody();
    const a = await agent.post('/api/v1/checkout').send(body);
    const b = await agent.post('/api/v1/checkout').send(body);
    expect(b.status).toBe(201);
    expect(b.body.data.reference).toBe(a.body.data.reference);
    expect(await Order.countDocuments()).toBe(1);
  });

  it('only one of two shoppers gets the last unit', async () => {
    await Inventory.updateOne({ product: cat.tv.id, branch: KANO }, { quantity: 1 });
    const [a, b] = await Promise.all([guestWithCart([{ product: cat.tv.id, quantity: 1 }]), guestWithCart([{ product: cat.tv.id, quantity: 1 }])]);
    const results = await Promise.all([
      a.post('/api/v1/checkout').send(checkoutBody({ contact: { ...contact, phone: '08061111111', email: undefined } })),
      b.post('/api/v1/checkout').send(checkoutBody({ contact: { ...contact, phone: '08062222222', email: undefined } })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await Inventory.findOne({ product: cat.tv.id, branch: KANO }).lean()).toMatchObject({ quantity: 1, reserved: 1 });
    expect(await Order.countDocuments()).toBe(1);
  });

  it('refuses checkout when something blocks the order, and never trusts client prices', async () => {
    const agent = await guestWithCart([{ product: cat.tv.id, quantity: 9 }]);
    const res = await agent.post('/api/v1/checkout').send({ ...checkoutBody(), total: 1, items: [{ price: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CHECKOUT_PROBLEMS');
  });

  it('enforces payment options per fulfilment method and requires an address for delivery', async () => {
    const agent = await guestWithCart([{ product: cat.tv.id, quantity: 1 }]);
    expect((await agent.post('/api/v1/checkout').send(checkoutBody({ paymentMethod: 'pay_on_delivery' }))).status).toBe(422);
    const res = await agent.post('/api/v1/checkout').send(checkoutBody({ fulfilment: 'delivery', paymentMethod: 'pay_on_delivery' }));
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.details)).toEqual(expect.arrayContaining(['deliveryZone', 'deliveryAddress']));
  });

  it('respects the guest-checkout setting', async () => {
    await Setting.updateOne({ _id: 'company' }, { guestCheckoutEnabled: false }, { upsert: true });
    const agent = await guestWithCart([{ product: cat.tv.id, quantity: 1 }]);
    const res = await agent.post('/api/v1/checkout').send(checkoutBody());
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SIGN_IN_REQUIRED');
  });

  it('a limited promotion is never used more times than allowed', async () => {
    const now = Date.now();
    await Promotion.create({ name: 'First buyer', code: 'ONCE', type: 'fixed_amount', value: 100_000, usageLimit: 1, startsAt: new Date(now - 1000), endsAt: new Date(now + 86_400_000), createdBy: world.users.superAdmin._id });
    const a = await guestWithCart([{ product: cat.tv.id, quantity: 1 }]);
    const b = await guestWithCart([{ product: cat.tv.id, quantity: 1 }]);
    const r1 = await a.post('/api/v1/checkout').send(checkoutBody({ promoCode: 'ONCE', contact: { ...contact, phone: '08063333333' } }));
    expect(r1.body.data.discountTotal).toBe(100_000);
    const r2 = await b.post('/api/v1/checkout').send(checkoutBody({ promoCode: 'ONCE', contact: { ...contact, phone: '08064444444', email: undefined } }));
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('PROMO_INVALID');
  });
});

describe('after the order', () => {
  async function placeAsCustomer() {
    await request(app).post('/api/v1/auth/register').send({ fullName: 'Aisha', phone: '08065550000', email: 'aisha@example.com', password: 'Aisha12345' });
    const s = await login(app, 'aisha@example.com', 'Aisha12345');
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${s.token}`);
    await auth(request(app).put('/api/v1/cart/items')).send({ product: cat.tv.id, quantity: 1 });
    await auth(request(app).put('/api/v1/cart/branch')).send({ branch: KANO });
    const order = await auth(request(app).post('/api/v1/checkout')).send(checkoutBody({ contact: { fullName: 'Aisha', phone: '08065550000' } }));
    expect(order.status).toBe(201);
    return { s, auth, order: order.body.data };
  }

  it('customers see and cancel their own orders, which releases the held stock', async () => {
    const { auth, order } = await placeAsCustomer();
    const mine = await auth(request(app).get('/api/v1/orders/mine'));
    expect(mine.body.data.map((o: { reference: string }) => o.reference)).toEqual([order.reference]);
    const cancelled = await auth(request(app).post(`/api/v1/orders/mine/${order.reference}/cancel`)).send({ reason: 'Changed my mind' });
    expect(cancelled.body.data).toMatchObject({ status: 'cancelled', canCancel: false });
    expect(await Inventory.findOne({ product: cat.tv.id, branch: KANO }).lean()).toMatchObject({ reserved: 0, quantity: 3 });
    expect((await auth(request(app).post(`/api/v1/orders/mine/${order.reference}/cancel`)).send({})).status).toBe(409);
  });

  it('nobody else can read the order; tracking needs the matching phone', async () => {
    const { order } = await placeAsCustomer();
    const other = await login(app, 'sales.abuja@test.local');
    expect((await as(app, other).get(`/api/v1/orders/mine/${order.reference}`)).status).toBe(404);
    const ok = await request(app).get(`/api/v1/orders/track?reference=${order.reference}&phone=0806%20555%200000`);
    expect(ok.body.data).toMatchObject({ reference: order.reference, status: 'pending', itemCount: 1 });
    expect(JSON.stringify(ok.body)).not.toMatch(/aisha@example.com/);
    expect((await request(app).get(`/api/v1/orders/track?reference=${order.reference}&phone=08000000000`)).status).toBe(404);
  });

  it('branch staff see their branch orders (sales staff only their own) and can cancel', async () => {
    const { order } = await placeAsCustomer();
    expect((await as(app, world.sessions.kanoAdmin).get('/api/v1/orders')).body.meta.total).toBe(1);
    expect((await as(app, world.sessions.abujaAdmin).get('/api/v1/orders')).body.meta.total).toBe(0);
    expect((await as(app, world.sessions.abujaAdmin).get(`/api/v1/orders/${order.id}`)).status).toBe(404);
    expect((await as(app, world.sessions.kanoSales).get('/api/v1/orders')).body.meta.total).toBe(0); // online order, not theirs
    const res = await as(app, world.sessions.kanoAdmin).post(`/api/v1/orders/${order.id}/cancel`, { reason: 'Customer called' });
    expect(res.body.data.status).toBe('cancelled');
    expect(await Inventory.findOne({ product: cat.tv.id, branch: KANO }).lean()).toMatchObject({ reserved: 0 });
  });
});
