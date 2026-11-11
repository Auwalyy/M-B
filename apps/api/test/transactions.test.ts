import { createHmac, randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processOutboxBatch } from '../src/core/events/outbox';
import { runJob } from '../src/core/jobs/scheduler';
import { setPaystackFetch } from '../src/core/payments/paystack';
import '../src/jobs';
import { DeliveryZone, Order } from '../src/modules/commerce/commerce.models';
import { Customer } from '../src/modules/customers/customer.model';
import { Enquiry } from '../src/modules/customers/crm.models';
import { Inventory, InventoryMovement } from '../src/modules/inventory/inventory.models';
import { MessageLog, Notification, WhatsAppClick } from '../src/modules/notifications/notification.models';
import { setWhatsAppFetch } from '../src/modules/notifications/notification.service';
import { Payment, Reservation } from '../src/modules/transactions/transactions.models';
import { as, makeApp, makeCatalog, makeWorld, stockIn } from './helpers';

const app = makeApp();
let world: Awaited<ReturnType<typeof makeWorld>>;
let cat: Awaited<ReturnType<typeof makeCatalog>>;
let KANO: string;
let zoneId: string;
const TV_PRICE = 60_000_000;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const inv = async () => (await Inventory.findOne({ product: cat.tv.id, branch: KANO }).lean())!;

beforeEach(async () => {
  world = await makeWorld(app);
  cat = await makeCatalog(app, world.sessions.superAdmin);
  KANO = world.branches.kano._id.toString();
  await stockIn(app, world.sessions.kanoAdmin, KANO, cat.tv.id, 5);
  zoneId = (await DeliveryZone.create({ branch: KANO, name: 'Kano city', fee: 250_000 }))._id.toString();
  setPaystackFetch(vi.fn().mockRejectedValue(new Error('Paystack not mocked')));
  setWhatsAppFetch(vi.fn().mockResolvedValue(json(200, { messages: [{ id: `wamid.${randomUUID()}` }] })));
});

const staffOrder = (extra: Record<string, unknown> = {}, s: keyof typeof world.sessions = 'kanoSales') =>
  as(app, world.sessions[s]).post('/api/v1/orders', {
    branch: KANO, channel: 'in_store', contact: { fullName: 'Walk In', phone: '08031110000' }, items: [{ product: cat.tv.id, quantity: 1 }],
    fulfilment: 'pickup', paymentMethod: 'cash', idempotencyKey: randomUUID(), ...extra,
  });
const status = (id: string, to: string, s: keyof typeof world.sessions = 'kanoAdmin') => as(app, world.sessions[s]).post(`/api/v1/orders/${id}/status`, { to });
const pay = (order: string, amount: number, method = 'cash', s: keyof typeof world.sessions = 'kanoSales', extra = {}) => as(app, world.sessions[s]).post('/api/v1/payments', { order, method, amount, ...extra });

async function onlineOrder(fulfilment: 'pickup' | 'delivery', paymentMethod: string) {
  const agent = request.agent(app);
  await agent.put('/api/v1/cart/items').send({ product: cat.tv.id, quantity: 1 });
  await agent.put('/api/v1/cart/branch').send({ branch: KANO });
  const res = await agent.post('/api/v1/checkout').send({
    fulfilment, paymentMethod, idempotencyKey: randomUUID(), contact: { fullName: 'Online Buyer', phone: '08032220000', email: 'buyer@example.com' },
    ...(fulfilment === 'delivery' ? { deliveryZone: zoneId, deliveryAddress: { line1: '1 Road', city: 'Kano', state: 'Kano' } } : {}),
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.data;
}

describe('order workflow', () => {
  it('runs an in-store pickup sale: payment before completion, stock sold at completion, customer stats updated', async () => {
    const created = await staffOrder();
    expect(created.status).toBe(201);
    const o = created.body.data;
    expect(o).toMatchObject({ status: 'confirmed', channel: 'in_store', outstanding: TV_PRICE });
    expect(await inv()).toMatchObject({ quantity: 5, reserved: 1 });

    expect((await status(o.id, 'ready_for_pickup')).status).toBe(409); // must be prepared first
    expect((await status(o.id, 'processing')).body.data.status).toBe('processing');
    expect((await status(o.id, 'out_for_delivery')).body.error.code).toBe('INVALID_TRANSITION'); // pickup order
    expect((await status(o.id, 'ready_for_pickup')).body.data.status).toBe('ready_for_pickup');

    const early = await status(o.id, 'completed');
    expect(early.body.error).toMatchObject({ code: 'OUTSTANDING_BALANCE', details: { outstanding: TV_PRICE } });

    const p = await pay(o.id, TV_PRICE);
    expect(p.body.data).toMatchObject({ status: 'success', receiptNumber: expect.stringMatching(/^RCP-KAN01-/) });
    const done = await status(o.id, 'completed');
    expect(done.body.data).toMatchObject({ status: 'completed', paymentStatus: 'paid', outstanding: 0 });
    expect(await inv()).toMatchObject({ quantity: 4, reserved: 0 });
    expect(await InventoryMovement.countDocuments({ type: 'sale' })).toBe(1);
    expect(await Customer.findOne({ phone: '+2348031110000' }).lean()).toMatchObject({ stats: { orderCount: 1, totalSpent: TV_PRICE } });

    const receipt = await as(app, world.sessions.kanoAdmin).get(`/api/v1/orders/${o.id}/receipt`);
    expect(receipt.body.data).toMatchObject({ total: TV_PRICE, amountPaid: TV_PRICE, outstanding: 0, payments: [{ method: 'cash', amount: TV_PRICE }] });
  });

  it('a staff member cannot overpay an order, and sales staff only see their own orders', async () => {
    const o = (await staffOrder()).body.data;
    expect((await pay(o.id, TV_PRICE + 1)).body.error.code).toBe('OVERPAYMENT');
    expect((await as(app, world.sessions.abujaSales).get(`/api/v1/orders/${o.id}`)).status).toBe(404);
    expect((await as(app, world.sessions.kanoSales).get('/api/v1/orders')).body.meta.total).toBe(1);
  });

  it('unattended online orders expire and release their stock', async () => {
    const o = await onlineOrder('pickup', 'pay_on_pickup');
    // createdAt is immutable in Mongoose; age the order through the driver.
    await Order.collection.updateOne({ _id: new Types.ObjectId(o.id) }, { $set: { createdAt: new Date(Date.now() - 49 * 3_600_000) } });
    expect(await runJob('orders.expire_unattended')).toBe(1);
    expect((await Order.findById(o.id).lean())!.status).toBe('cancelled');
    expect(await inv()).toMatchObject({ reserved: 0 });
  });
});

describe('deliveries', () => {
  it('dispatch sells the stock, delivery with a balance waits for payment, then completes', async () => {
    const o = await onlineOrder('delivery', 'pay_on_delivery');
    await status(o.id, 'confirmed');
    await status(o.id, 'processing');
    const delivery = (await as(app, world.sessions.kanoAdmin).get('/api/v1/deliveries')).body.data[0];
    expect(delivery).toMatchObject({ status: 'pending', fee: 250_000, order: { reference: o.reference } });

    const d = (s: string) => as(app, world.sessions.kanoAdmin).post(`/api/v1/deliveries/${delivery.id}/status`, { status: s });
    expect((await d('picked_up')).status).toBe(409); // assign a rider first
    await as(app, world.sessions.kanoAdmin).post(`/api/v1/deliveries/${delivery.id}/assign`, { name: 'Sani Rider', phone: '08055550000' });
    expect((await d('picked_up')).body.data.delivery.status).toBe('picked_up');
    expect((await Order.findById(o.id).lean())!.status).toBe('out_for_delivery');
    expect(await inv()).toMatchObject({ quantity: 4, reserved: 0 });

    const delivered = await d('delivered');
    expect(delivered.body.data.message).toMatch(/still to be paid/);
    expect((await Order.findById(o.id).lean())!.status).toBe('out_for_delivery');
    await pay(o.id, o.total, 'pos', 'kanoAdmin');
    expect((await status(o.id, 'completed')).body.data.status).toBe('completed');
  });

  it('a returned delivery cancels the order and puts the goods back on the shelf', async () => {
    const o = await onlineOrder('delivery', 'pay_on_delivery');
    await status(o.id, 'confirmed');
    await status(o.id, 'processing');
    const delivery = (await as(app, world.sessions.kanoAdmin).get('/api/v1/deliveries')).body.data[0];
    const d = (s: string) => as(app, world.sessions.kanoAdmin).post(`/api/v1/deliveries/${delivery.id}/status`, { status: s });
    await as(app, world.sessions.kanoAdmin).post(`/api/v1/deliveries/${delivery.id}/assign`, { name: 'Rider', phone: '08055550000' });
    await d('picked_up');
    expect(await inv()).toMatchObject({ quantity: 4 });
    await d('failed');
    await d('returned');
    expect((await Order.findById(o.id).lean())!.status).toBe('cancelled');
    expect(await inv()).toMatchObject({ quantity: 5, reserved: 0 });
  });
});

describe('payments', () => {
  it('bank transfers recorded by sales staff wait for a branch admin to confirm', async () => {
    const o = (await staffOrder({ paymentMethod: 'bank_transfer' })).body.data;
    expect((await pay(o.id, TV_PRICE, 'bank_transfer')).body.error.details.providerReference).toBeTruthy();
    const p = (await pay(o.id, TV_PRICE, 'bank_transfer', 'kanoSales', { providerReference: 'GTB-123' })).body.data;
    expect(p.status).toBe('pending');
    expect(await Notification.countDocuments({ recipient: world.users.kanoAdmin._id, type: 'payment.to_confirm' })).toBe(1);
    expect((await as(app, world.sessions.kanoSales).post(`/api/v1/payments/${p.id}/confirm`, {})).status).toBe(403);
    const ok = await as(app, world.sessions.kanoAdmin).post(`/api/v1/payments/${p.id}/confirm`, {});
    expect(ok.body.data.status).toBe('success');
    expect((await Order.findById(o.id).lean())!.paymentStatus).toBe('paid');
  });

  it('refunds a completed sale with restock: order refunded, stock back, customer total reduced', async () => {
    const o = (await staffOrder()).body.data;
    const p = (await pay(o.id, TV_PRICE)).body.data;
    await status(o.id, 'processing');
    await status(o.id, 'ready_for_pickup');
    await status(o.id, 'completed');
    const tooMuch = await as(app, world.sessions.kanoAdmin).post(`/api/v1/payments/${p.id}/refunds`, { amount: TV_PRICE + 1, reason: 'x' });
    expect(tooMuch.status).toBe(400);
    expect((await as(app, world.sessions.kanoSales).post(`/api/v1/payments/${p.id}/refunds`, { amount: 100, reason: 'x' })).status).toBe(403);
    const r = await as(app, world.sessions.kanoAdmin).post(`/api/v1/payments/${p.id}/refunds`, { amount: TV_PRICE, reason: 'Faulty screen', restock: true });
    expect(r.status).toBe(201);
    expect((await Order.findById(o.id).lean())).toMatchObject({ status: 'refunded', paymentStatus: 'refunded', amountPaid: 0 });
    expect(await inv()).toMatchObject({ quantity: 5 });
    expect((await Customer.findOne({ phone: '+2348031110000' }).lean())!.stats.totalSpent).toBe(0);
  });
});

describe('Paystack', () => {
  const sign = (body: string) => createHmac('sha512', 'sk_test_unit_tests_only').update(body).digest('hex');
  const webhook = (body: object, signature?: string) => {
    const raw = JSON.stringify(body);
    return request(app).post('/api/v1/webhooks/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', signature ?? sign(raw)).send(raw);
  };

  async function startPayment() {
    const o = await onlineOrder('pickup', 'paystack');
    const fetchMock = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      if (String(url).endsWith('/transaction/initialize')) {
        const body = JSON.parse(String(init.body));
        return json(200, { status: true, data: { authorization_url: `https://checkout.paystack.com/${body.reference}`, access_code: 'x', reference: body.reference } });
      }
      throw new Error(`unexpected ${url}`);
    });
    setPaystackFetch(fetchMock);
    const init = await request(app).post('/api/v1/payments/paystack/initialize').send({ order: o.reference, phone: '08032220000' });
    expect(init.status).toBe(200);
    const sent = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(sent).toMatchObject({ amount: TV_PRICE, currency: 'NGN', email: 'buyer@example.com', callback_url: 'http://localhost:3000/payment/callback' });
    return { order: o, reference: init.body.data.reference as string, url: init.body.data.authorizationUrl as string };
  }

  const verifyReturns = (reference: string, data: Record<string, unknown>) =>
    setPaystackFetch(vi.fn().mockImplementation(async (url: string) => (String(url).includes(`/transaction/verify/${reference}`) ? json(200, { status: true, data: { id: 99, reference, currency: 'NGN', channel: 'card', paid_at: new Date().toISOString(), ...data } }) : json(404, { status: false }))));

  it('only the order owner (or the checkout phone) can start a payment', async () => {
    const o = await onlineOrder('pickup', 'paystack');
    expect((await request(app).post('/api/v1/payments/paystack/initialize').send({ order: o.reference, phone: '08000000000' })).status).toBe(404);
  });

  it('never trusts the browser: a payment succeeds only when Paystack confirms the right amount', async () => {
    const { order, reference, url } = await startPayment();
    expect(url).toContain(reference);

    verifyReturns(reference, { status: 'success', amount: TV_PRICE - 100 });
    expect((await request(app).get(`/api/v1/payments/paystack/verify/${reference}`)).body.data.status).toBe('failed');
    expect((await Order.findById(order.id).lean())!.paymentStatus).toBe('unpaid');

    const second = await startPayment();
    verifyReturns(second.reference, { status: 'success', amount: TV_PRICE });
    const ok = await request(app).get(`/api/v1/payments/paystack/verify/${second.reference}`);
    expect(ok.body.data).toMatchObject({ status: 'success', outstanding: 0 });
    // Paid online in full: the order confirms itself.
    expect((await Order.findById(second.order.id).lean())).toMatchObject({ paymentStatus: 'paid', status: 'confirmed' });
  });

  it('accepts only signed webhooks and processes each event once', async () => {
    const { order, reference } = await startPayment();
    const evt = { event: 'charge.success', data: { id: 99, reference, amount: TV_PRICE, currency: 'NGN', status: 'success' } };
    expect((await webhook(evt, 'f'.repeat(128))).status).toBe(401);

    verifyReturns(reference, { status: 'success', amount: TV_PRICE });
    expect((await webhook(evt)).status).toBe(200);
    expect((await webhook(evt)).status).toBe(200);
    const payments = await Payment.find({ order: order.id }).lean();
    expect(payments.filter((p) => p.status === 'success')).toHaveLength(1);
    expect(payments[0]).toMatchObject({ verifiedBy: 'webhook', receiptNumber: expect.stringMatching(/^RCP-/) });
  });

  it('refunds card payments through Paystack and completes them on the refund webhook', async () => {
    const { order, reference } = await startPayment();
    verifyReturns(reference, { status: 'success', amount: TV_PRICE });
    await request(app).get(`/api/v1/payments/paystack/verify/${reference}`);
    const payment = await Payment.findOne({ reference }).lean();

    setPaystackFetch(vi.fn().mockResolvedValue(json(200, { status: true, data: { id: 555, status: 'pending', amount: 1_000_000 } })));
    const r = await as(app, world.sessions.kanoAdmin).post(`/api/v1/payments/${payment!._id}/refunds`, { amount: 1_000_000, reason: 'Price match' });
    expect(r.body.data.refunds[0]).toMatchObject({ status: 'pending', amount: 1_000_000 });
    expect((await Order.findById(order.id).lean())!.amountPaid).toBe(TV_PRICE); // not yet processed

    await webhook({ event: 'refund.processed', data: { id: 555, transaction_reference: reference, amount: 1_000_000 } });
    expect((await Payment.findOne({ reference }).lean())!.refunds[0]!.status).toBe('processed');
    expect((await Order.findById(order.id).lean())).toMatchObject({ amountPaid: TV_PRICE - 1_000_000, paymentStatus: 'partially_refunded' });
  });
});

describe('reservations', () => {
  const reserve = (extra: Record<string, unknown> = {}) =>
    request(app).post('/api/v1/reservations').send({ branch: KANO, items: [{ product: cat.tv.id, quantity: 2 }], contact: { fullName: 'Reserver', phone: '08043330000', email: 'r@example.com' }, ...extra });

  it('holds stock on submission and tells the branch', async () => {
    const res = await reserve();
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'pending', reference: expect.stringMatching(/^RSV-KAN01-/), total: 2 * TV_PRICE, allowedActions: [] });
    expect(await inv()).toMatchObject({ reserved: 2 });
    expect(await Notification.countDocuments({ type: 'reservation.new', recipient: world.users.kanoAdmin._id })).toBe(1);
    const track = await request(app).get(`/api/v1/reservations/track?reference=${res.body.data.reference}&phone=08043330000`);
    expect(track.body.data).toMatchObject({ status: 'pending', itemCount: 2 });
  });

  it('confirm then convert to an order keeps exactly one hold and the reserved price', async () => {
    const r = (await reserve()).body.data;
    await as(app, world.sessions.superAdmin).patch(`/api/v1/products/${cat.tv.id}`, { discountPrice: 55_000_000 });
    expect((await as(app, world.sessions.kanoSales).post(`/api/v1/reservations/${r.id}/confirm`, {})).status).toBe(403);
    const confirmed = await as(app, world.sessions.kanoAdmin).post(`/api/v1/reservations/${r.id}/confirm`, {});
    expect(confirmed.body.data).toMatchObject({ status: 'confirmed', allowedActions: expect.arrayContaining(['convert', 'cancel']) });

    const order = await as(app, world.sessions.kanoSales).post(`/api/v1/reservations/${r.id}/convert`, { paymentMethod: 'cash' });
    expect(order.status).toBe(201);
    expect(order.body.data).toMatchObject({ status: 'confirmed', total: 2 * TV_PRICE, items: [{ quantity: 2, unitPrice: TV_PRICE }] });
    expect(await inv()).toMatchObject({ reserved: 2 });
    expect((await Reservation.findById(r.id).lean())!.status).toBe('converted');
  });

  it('rejecting or expiring releases the stock', async () => {
    const a = (await reserve()).body.data;
    expect((await as(app, world.sessions.kanoAdmin).post(`/api/v1/reservations/${a.id}/reject`, {})).status).toBe(422);
    await as(app, world.sessions.kanoAdmin).post(`/api/v1/reservations/${a.id}/reject`, { reason: 'Display unit only' });
    expect(await inv()).toMatchObject({ reserved: 0 });

    const b = (await reserve()).body.data;
    await Reservation.updateOne({ _id: b.id }, { expiresAt: new Date(Date.now() - 1000) });
    expect(await runJob('reservations.expire')).toBe(1);
    expect((await Reservation.findById(b.id).lean())!.status).toBe('expired');
    expect(await inv()).toMatchObject({ reserved: 0 });
  });

  it('respects branch settings and the per-item limit, and never over-reserves', async () => {
    expect((await reserve({ items: [{ product: cat.tv.id, quantity: 11 }] })).status).toBe(400);
    expect((await reserve({ items: [{ product: cat.tv.id, quantity: 6 }] })).status).toBe(409);
    await as(app, world.sessions.kanoAdmin).patch(`/api/v1/branches/${KANO}`, { settings: { reservationsEnabled: false } });
    expect((await reserve()).body.error.code).toBe('RESERVATIONS_DISABLED');
  });

  it('staff reservations from an enquiry are confirmed at once and close the enquiry', async () => {
    const enquiry = await as(app, world.sessions.kanoSales).post('/api/v1/enquiries/log', { branch: KANO, channel: 'whatsapp', name: 'Hauwa', phone: '08044440000', subject: 'TV', message: 'Hold one for me' });
    const res = await as(app, world.sessions.kanoSales).post('/api/v1/reservations/staff', {
      branch: KANO, channel: 'whatsapp', items: [{ product: cat.tv.id, quantity: 1 }], contact: { fullName: 'Hauwa', phone: '08044440000' }, enquiry: enquiry.body.data.id,
    });
    expect(res.body.data.status).toBe('confirmed');
    expect((await Enquiry.findById(enquiry.body.data.id).lean())!.status).toBe('converted');
  });
});

describe('notifications and WhatsApp', () => {
  it('branch admins get in-app notifications for new orders and can mark them read', async () => {
    await onlineOrder('pickup', 'pay_on_pickup');
    const admin = as(app, world.sessions.kanoAdmin);
    expect((await admin.get('/api/v1/notifications/unread-count')).body.data.count).toBeGreaterThanOrEqual(1);
    const list = await admin.get('/api/v1/notifications?unread=true');
    expect(list.body.data[0]).toMatchObject({ type: 'order.new', link: expect.stringMatching(/^\/admin\/orders\//) });
    expect((await as(app, world.sessions.abujaAdmin).get('/api/v1/notifications')).body.meta.total).toBe(0);
    await admin.post('/api/v1/notifications/read-all');
    expect((await admin.get('/api/v1/notifications/unread-count')).body.data.count).toBe(0);
  });

  it('sends order updates with an approved WhatsApp template and records delivery only from Meta webhooks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { messages: [{ id: 'wamid.ABC' }] }));
    setWhatsAppFetch(fetchMock);
    const o = await onlineOrder('pickup', 'pay_on_pickup');
    await status(o.id, 'confirmed');
    await processOutboxBatch(50);
    const sent = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(sent).toMatchObject({ to: '2348032220000', type: 'template', template: { name: 'order_update', components: [{ parameters: [{ text: 'Online' }, { text: o.reference }, { text: 'confirmed' }] }] } });
    expect((await MessageLog.findOne({ providerMessageId: 'wamid.ABC' }).lean())!.status).toBe('accepted');

    const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.ABC', status: 'delivered' }] } }] }] });
    const unsigned = await request(app).post('/api/v1/webhooks/whatsapp').set('Content-Type', 'application/json').send(body);
    expect(unsigned.status).toBe(401);
    const sig = `sha256=${createHmac('sha256', 'test-app-secret').update(body).digest('hex')}`;
    await request(app).post('/api/v1/webhooks/whatsapp').set('Content-Type', 'application/json').set('x-hub-signature-256', sig).send(body);
    expect((await MessageLog.findOne({ providerMessageId: 'wamid.ABC' }).lean())!.status).toBe('delivered');

    const handshake = await request(app).get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345');
    expect(handshake.text).toBe('12345');
  });

  it('builds pre-filled wa.me links per branch and logs clicks as intent only', async () => {
    const link = await request(app).get(`/api/v1/whatsapp/link?context=product&ref=${cat.tv.slug}&branch=${KANO}`);
    expect(link.body.data.message).toBe(`Hello Mudassir & Brothers, I am interested in ${cat.tv.name}, Product SKU: SAM-TV-001. Please confirm its availability and price at your Branch KAN01 branch.`);
    expect(link.body.data.url).toMatch(/^https:\/\/wa\.me\/234\d{10}\?text=/);
    expect((await request(app).post('/api/v1/whatsapp/click').send({ context: 'product', ref: cat.tv.slug, branch: KANO })).status).toBe(204);
    expect(await WhatsAppClick.countDocuments()).toBe(1);
  });
});
