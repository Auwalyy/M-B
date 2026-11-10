import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { processOutboxBatch } from '../src/core/events/outbox';
import { testMailbox } from '../src/core/mail/mailer';
import { Customer } from '../src/modules/customers/customer.model';
import { User } from '../src/modules/users/user.model';
import { as, makeApp, makeWorld } from './helpers';

const app = makeApp();
let world: Awaited<ReturnType<typeof makeWorld>>;
let KANO: string;
let ABUJA: string;

beforeEach(async () => {
  world = await makeWorld(app);
  KANO = world.branches.kano._id.toString();
  ABUJA = world.branches.abuja._id.toString();
});

const register = (s: keyof typeof world.sessions, body: Record<string, unknown> = {}) =>
  as(app, world.sessions[s]).post('/api/v1/customers', { fullName: 'Musa Ibrahim', phone: '0803 777 1234', branch: KANO, source: 'walk_in', ...body });

describe('central customer identity', () => {
  it('sales staff register a walk-in customer at their branch', async () => {
    const res = await register('kanoSales', { tags: ['VIP'], address: { line1: '3 Ahmadu Bello Way', city: 'Kano', state: 'Kano' } });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      phone: '+2348037771234',
      source: 'walk_in',
      tags: ['vip'],
      preferredBranch: { code: 'KAN01' },
      branchesServed: [{ code: 'KAN01' }],
      registeredBy: { fullName: 'Kano Sales' },
      hasAccount: false,
    });
    expect(res.body.data.addresses[0]).toMatchObject({ isDefault: true });
  });

  it('never registers the same phone twice; another branch finds and links the existing record', async () => {
    const first = (await register('kanoSales')).body.data;
    const dupe = await register('abujaSales', { fullName: 'M. Ibrahim', phone: '+234 803 777 1234', branch: ABUJA });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error).toMatchObject({ code: 'CUSTOMER_EXISTS', details: { customerId: first.id, inScope: false } });

    const lookup = await as(app, world.sessions.abujaSales).get('/api/v1/customers/lookup?phone=08037771234');
    expect(lookup.body.data).toEqual({ id: first.id, fullName: 'Musa Ibrahim', phone: '+2348037771234', inScope: false });
    // Not visible to Abuja until linked.
    expect((await as(app, world.sessions.abujaSales).get(`/api/v1/customers/${first.id}`)).status).toBe(404);

    const linked = await as(app, world.sessions.abujaSales).post(`/api/v1/customers/${first.id}/branches`, { branch: ABUJA });
    expect(linked.body.data.branchesServed.map((b: { code: string }) => b.code).sort()).toEqual(['ABJ01', 'KAN01']);
    expect((await as(app, world.sessions.abujaSales).get(`/api/v1/customers/${first.id}`)).status).toBe(200);
    expect(await Customer.countDocuments()).toBe(1);
  });

  it('links an online customer account to the same record and keeps the account in sync', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({ fullName: 'Online Buyer', phone: '08037771234', password: 'Buyer12345' });
    const lookup = await as(app, world.sessions.kanoSales).get('/api/v1/customers/lookup?phone=08037771234');
    const id = lookup.body.data.id;
    expect(id).toBe(reg.body.data.user.customerId);
    await as(app, world.sessions.kanoSales).post(`/api/v1/customers/${id}/branches`, { branch: KANO });
    const upd = await as(app, world.sessions.kanoAdmin).patch(`/api/v1/customers/${id}`, { fullName: 'Online Buyer Jnr', email: 'buyer@example.com' });
    expect(upd.body.data).toMatchObject({ hasAccount: true, fullName: 'Online Buyer Jnr' });
    const user = await User.findById(reg.body.data.user.id).lean();
    expect(user).toMatchObject({ fullName: 'Online Buyer Jnr', email: 'buyer@example.com' });
  });

  it('scopes customer lists by branch and only allows registering at your own branch', async () => {
    await register('kanoSales');
    await register('abujaSales', { fullName: 'Ada Obi', phone: '08055550000', branch: ABUJA });
    const kano = await as(app, world.sessions.kanoAdmin).get('/api/v1/customers');
    expect(kano.body.data.map((c: { fullName: string }) => c.fullName)).toEqual(['Musa Ibrahim']);
    expect((await as(app, world.sessions.superAdmin).get('/api/v1/customers')).body.meta.total).toBe(2);
    expect((await register('kanoSales', { phone: '08011112222', branch: ABUJA })).status).toBe(403);
  });

  it('searches by name or any phone format', async () => {
    await register('kanoSales');
    for (const q of ['musa', '0803 777 1234', '7771234']) {
      const res = await as(app, world.sessions.kanoAdmin).get(`/api/v1/customers?q=${encodeURIComponent(q)}`);
      expect(res.body.meta.total, q).toBe(1);
    }
  });

  it('sales staff cannot edit customer details', async () => {
    const c = (await register('kanoSales')).body.data;
    expect((await as(app, world.sessions.kanoSales).patch(`/api/v1/customers/${c.id}`, { notes: 'x' })).status).toBe(403);
  });
});

describe('communication history', () => {
  it('records calls and WhatsApp chats in order, newest first', async () => {
    const c = (await register('kanoSales')).body.data;
    const res = await as(app, world.sessions.kanoSales).post(`/api/v1/customers/${c.id}/interactions`, {
      branch: KANO,
      channel: 'whatsapp',
      direction: 'inbound',
      summary: 'Asked about the 55" TV price',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.map((i: { channel: string }) => i.channel)).toEqual(['whatsapp', 'system']);
    expect(res.body.data[0]).toMatchObject({ recordedBy: { fullName: 'Kano Sales' }, branch: { code: 'KAN01' } });
  });
});

describe('segments', () => {
  it('saves conditions, counts matches within your scope, and filters the customer list', async () => {
    await register('kanoSales', { tags: ['wholesale'] });
    await register('kanoSales', { fullName: 'Retail Rita', phone: '08022223333' });
    await register('abujaSales', { fullName: 'Abuja Wholesale', phone: '08044445555', branch: ABUJA, tags: ['wholesale'] });
    await Customer.updateOne({ phone: '+2348037771234' }, { 'stats.totalSpent': 900_000_00, 'stats.orderCount': 12 });

    const preview = await as(app, world.sessions.kanoAdmin).post('/api/v1/customer-segments/preview', { tags: ['wholesale'] });
    expect(preview.body.data.count).toBe(1); // Abuja's wholesale customer is outside Kano's scope

    const seg = await as(app, world.sessions.superAdmin).post('/api/v1/customer-segments', {
      name: 'Big wholesale buyers',
      filter: { tags: ['wholesale'], minTotalSpent: 500_000_00 },
    });
    expect(seg.status).toBe(201);
    expect(seg.body.data.customerCount).toBe(1);
    const list = await as(app, world.sessions.kanoAdmin).get(`/api/v1/customers?segment=${seg.body.data.id}`);
    expect(list.body.data.map((c: { fullName: string }) => c.fullName)).toEqual(['Musa Ibrahim']);

    const inactive = await as(app, world.sessions.superAdmin).post('/api/v1/customer-segments/preview', { inactiveDays: 30 });
    expect(inactive.body.data.count).toBe(3); // nobody has ordered yet

    expect((await as(app, world.sessions.kanoSales).post('/api/v1/customer-segments', { name: 'x', filter: { minOrders: 1 } })).status).toBe(403);
    expect((await as(app, world.sessions.superAdmin).post('/api/v1/customer-segments/preview', {})).status).toBe(422);
  });
});

describe('enquiries', () => {
  const publicEnquiry = (body: Record<string, unknown> = {}) =>
    request(app).post('/api/v1/enquiries').send({ branch: KANO, name: 'Visitor', phone: '08099990000', subject: 'Price of TV', message: 'Do you deliver to Nassarawa?', ...body });

  it('accepts website enquiries, alerts the branch admin and returns only a reference', async () => {
    const res = await publicEnquiry();
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ reference: expect.stringMatching(/^ENQ-KAN01-\d{6}$/) });
    await processOutboxBatch();
    expect(testMailbox.map((m) => m.to)).toEqual(['admin.kano@test.local']);
  });

  it('rejects spam bots (honeypot) and unknown branches', async () => {
    expect((await publicEnquiry({ website: 'http://spam' })).status).toBe(422);
    expect((await publicEnquiry({ branch: '64b000000000000000000099' })).status).toBe(400);
  });

  it('links enquiries from known customers and records them in their history', async () => {
    const c = (await register('kanoSales', { phone: '08099990000' })).body.data;
    await publicEnquiry();
    const list = await as(app, world.sessions.kanoSales).get('/api/v1/enquiries');
    expect(list.body.data[0]).toMatchObject({ customer: { id: c.id }, channel: 'web_form', status: 'new' });
    const history = await as(app, world.sessions.kanoSales).get(`/api/v1/customers/${c.id}/interactions`);
    expect(history.body.data[0].summary).toBe('Enquiry: Price of TV');
  });

  it('staff log WhatsApp enquiries, assign them and add notes; other branches cannot see them', async () => {
    const logged = await as(app, world.sessions.kanoSales).post('/api/v1/enquiries/log', {
      branch: KANO, channel: 'whatsapp', name: 'Halima', phone: '08012345678', subject: 'Fridge availability', message: 'Wants a 2-door fridge',
    });
    expect(logged.status).toBe(201);
    expect(logged.body.data).toMatchObject({ channel: 'whatsapp', createdBy: { fullName: 'Kano Sales' } });
    const id = logged.body.data.id;

    const wrongAssignee = await as(app, world.sessions.kanoAdmin).patch(`/api/v1/enquiries/${id}`, { assignedTo: world.users.abujaSales._id.toString() });
    expect(wrongAssignee.status).toBe(400);
    const updated = await as(app, world.sessions.kanoAdmin).patch(`/api/v1/enquiries/${id}`, { assignedTo: world.users.kanoSales._id.toString(), note: 'Call her back after 4pm' });
    expect(updated.body.data).toMatchObject({ status: 'in_progress', assignedTo: { fullName: 'Kano Sales' }, notes: [{ text: 'Call her back after 4pm', by: { fullName: 'Kano Admin' } }] });

    const mine = await as(app, world.sessions.kanoSales).get('/api/v1/enquiries?assignedToMe=true');
    expect(mine.body.meta.total).toBe(1);
    expect((await as(app, world.sessions.abujaAdmin).get(`/api/v1/enquiries/${id}`)).status).toBe(404);
    expect((await as(app, world.sessions.abujaSales).post('/api/v1/enquiries/log', { branch: KANO, channel: 'phone', name: 'x', phone: '08012345678', subject: 's', message: 'm' })).status).toBe(403);
  });

  it('rate-limits the public form', async () => {
    const limited = makeApp();
    const results = [];
    for (let i = 0; i < 22; i++) results.push((await request(limited).post('/api/v1/enquiries').send({})).status);
    expect(results.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
