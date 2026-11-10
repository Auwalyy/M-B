import { beforeEach, describe, expect, it } from 'vitest';
import { processOutboxBatch } from '../src/core/events/outbox';
import { testMailbox } from '../src/core/mail/mailer';
import { Inventory, InventoryMovement } from '../src/modules/inventory/inventory.models';
import { Setting } from '../src/modules/settings/setting.model';
import { as, makeApp, makeCatalog, makeWorld, stockIn } from './helpers';

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
});

const line = (product: string, quantity: number, variantId: string | null = null) => ({ product, variantId, quantity });

describe('receiving and removing stock', () => {
  it('tracks each branch independently and records every movement', async () => {
    await stockIn(app, world.sessions.kanoAdmin, KANO, cat.tv.id, 10);
    await stockIn(app, world.sessions.abujaAdmin, ABUJA, cat.tv.id, 8);
    const sa = await as(app, world.sessions.superAdmin).get(`/api/v1/inventory?product=${cat.tv.id}`);
    const byBranch = Object.fromEntries(sa.body.data.map((i: { branch: { code: string }; quantity: number }) => [i.branch.code, i.quantity]));
    expect(byBranch).toEqual({ KAN01: 10, ABJ01: 8 });

    const moves = await as(app, world.sessions.kanoAdmin).get('/api/v1/inventory/movements');
    expect(moves.body.data).toHaveLength(1); // the Kano admin sees Kano only
    expect(moves.body.data[0]).toMatchObject({ type: 'stock_in', quantityDelta: 10, balanceAfter: 10, reference: { label: 'INV-1' } });
  });

  it('requires a variant for variant products', async () => {
    const res = await as(app, world.sessions.kanoAdmin).post('/api/v1/inventory/stock-in', { branch: KANO, items: [line(cat.kaftan.id, 1)] });
    expect(res.status).toBe(400);
  });

  it('never removes more than is available', async () => {
    await stockIn(app, world.sessions.kanoAdmin, KANO, cat.tv.id, 3);
    const res = await as(app, world.sessions.kanoAdmin).post('/api/v1/inventory/stock-out', { branch: KANO, items: [line(cat.tv.id, 4)], reason: 'damaged' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: { available: 3, requested: 4 } });
  });

  it('a multi-line removal is all-or-nothing', async () => {
    await stockIn(app, world.sessions.kanoAdmin, KANO, cat.tv.id, 5);
    await stockIn(app, world.sessions.kanoAdmin, KANO, cat.kaftan.id, 1, cat.kaftan.variants[0].id);
    const res = await as(app, world.sessions.kanoAdmin).post('/api/v1/inventory/stock-out', {
      branch: KANO,
      items: [line(cat.tv.id, 2), line(cat.kaftan.id, 5, cat.kaftan.variants[0].id)],
      reason: 'lost',
    });
    expect(res.status).toBe(409);
    const tv = await Inventory.findOne({ product: cat.tv.id, branch: KANO }).lean();
    expect(tv!.quantity).toBe(5); // the first line was rolled back
    expect(await InventoryMovement.countDocuments({ type: 'stock_out' })).toBe(0);
  });

  it('prevents overselling under concurrency: 20 parallel removals of 1 unit from 5', async () => {
    await stockIn(app, world.sessions.kanoAdmin, KANO, cat.tv.id, 5);
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        as(app, world.sessions.kanoAdmin).post('/api/v1/inventory/stock-out', { branch: KANO, items: [line(cat.tv.id, 1)], reason: 'internal_use' }),
      ),
    );
    expect(attempts.filter((r) => r.status === 201)).toHaveLength(5);
    expect(attempts.filter((r) => r.status === 409)).toHaveLength(15);
    const inv = await Inventory.findOne({ product: cat.tv.id, branch: KANO }).lean();
    expect(inv!.quantity).toBe(0);
    expect(await InventoryMovement.countDocuments({ type: 'stock_out' })).toBe(5);
  });

  it('protects reserved units unless the caller may override', async () => {
    await stockIn(app, world.sessions.kanoAdmin, KANO, cat.tv.id, 5);
    await Inventory.updateOne({ product: cat.tv.id, branch: KANO }, { reserved: 4 });
    const blocked = await as(app, world.sessions.kanoAdmin).post('/api/v1/inventory/stock-out', { branch: KANO, items: [line(cat.tv.id, 2)], reason: 'damaged' });
    expect(blocked.status).toBe(409);
    // The super admin holds inventory:override.
    const overridden = await as(app, world.sessions.superAdmin).post('/api/v1/inventory/stock-out', { branch: KANO, items: [line(cat.tv.id, 2)], reason: 'damaged' });
    expect(overridden.status).toBe(201);
    expect(overridden.body.data[0]).toMatchObject({ quantity: 3, reserved: 4, available: -1 });
  });

  it('keeps branch staff to their own branch', async () => {
    const other = await as(app, world.sessions.kanoAdmin).post('/api/v1/inventory/stock-in', { branch: ABUJA, items: [line(cat.tv.id, 1)] });
    expect(other.status).toBe(404);
    const sales = await as(app, world.sessions.kanoSales).post('/api/v1/inventory/stock-in', { branch: KANO, items: [line(cat.tv.id, 1)] });
    expect(sales.status).toBe(403);
    await stockIn(app, world.sessions.abujaAdmin, ABUJA, cat.tv.id, 3);
    const list = await as(app, world.sessions.kanoAdmin).get(`/api/v1/inventory?branch=${ABUJA}`);
    expect(list.body.data).toHaveLength(0);
  });
});

describe('low stock', () => {
  it('lists items at or below their reorder level and emails the branch admin once when stock crosses it', async () => {
    const inv = await stockIn(app, world.sessions.kanoAdmin, KANO, cat.tv.id, 10);
    await as(app, world.sessions.kanoAdmin).patch(`/api/v1/inventory/${inv.id}`, { reorderLevel: 6 });
    const out = (q: number) => as(app, world.sessions.kanoAdmin).post('/api/v1/inventory/stock-out', { branch: KANO, items: [line(cat.tv.id, q)], reason: 'internal_use' });

    await out(3); // 7 left: above the level
    await processOutboxBatch();
    expect(testMailbox).toHaveLength(0);
    await out(2); // 5 left: crosses the level
    await out(1); // 4 left: already low, no second email
    await processOutboxBatch();
    expect(testMailbox).toHaveLength(1);
    expect(testMailbox[0]).toMatchObject({ to: 'admin.kano@test.local' });
    expect(testMailbox[0]!.subject).toMatch(/Low stock: Samsung/);

    const low = await as(app, world.sessions.kanoAdmin).get('/api/v1/inventory/low-stock');
    expect(low.body.data.map((i: { sku: string; level: string }) => [i.sku, i.level])).toEqual([['SAM-TV-001', 'low']]);
  });

  it('uses the company default when an item has no reorder level', async () => {
    await Setting.updateOne({ _id: 'company' }, { lowStockDefault: 20 }, { upsert: true });
    await stockIn(app, world.sessions.kanoAdmin, KANO, cat.tv.id, 15);
    const low = await as(app, world.sessions.kanoAdmin).get('/api/v1/inventory?lowStock=true');
    expect(low.body.data[0]).toMatchObject({ effectiveReorderLevel: 20, level: 'low' });
  });
});

describe('stock adjustments', () => {
  beforeEach(async () => {
    await stockIn(app, world.sessions.kanoAdmin, KANO, cat.tv.id, 10);
  });
  const adjust = (s: keyof typeof world.sessions, delta: number, branch = KANO) =>
    as(app, world.sessions[s]).post('/api/v1/inventory/adjustments', { branch, items: [{ product: cat.tv.id, delta }], reason: 'Monthly count' });

  it('applies small corrections by a branch admin immediately', async () => {
    const res = await adjust('kanoAdmin', -2);
    expect(res.body.data).toMatchObject({ status: 'applied', reference: expect.stringMatching(/^ADJ-KAN01-\d{6}$/) });
    expect((await Inventory.findOne({ product: cat.tv.id, branch: KANO }).lean())!.quantity).toBe(8);
  });

  it('holds large corrections, and every correction by sales staff, for a second person', async () => {
    const large = await adjust('kanoAdmin', -50 + 45); // -5 is within the default threshold of 10…
    expect(large.body.data.status).toBe('applied');
    const big = await adjust('kanoAdmin', 25); // …+25 is not
    expect(big.body.data.status).toBe('pending');
    const sales = await adjust('kanoSales', -1);
    expect(sales.body.data.status).toBe('pending');
    expect((await Inventory.findOne({ product: cat.tv.id, branch: KANO }).lean())!.quantity).toBe(5);
  });

  it('cannot be approved by the requester; another approver applies it exactly once', async () => {
    const pending = (await adjust('kanoAdmin', 30)).body.data;
    const self = await as(app, world.sessions.kanoAdmin).post(`/api/v1/inventory/adjustments/${pending.id}/approve`, {});
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SELF_APPROVAL');

    const [a, b] = await Promise.all([
      as(app, world.sessions.superAdmin).post(`/api/v1/inventory/adjustments/${pending.id}/approve`, { note: 'Checked' }),
      as(app, world.sessions.superAdmin).post(`/api/v1/inventory/adjustments/${pending.id}/approve`, { note: 'Checked' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await Inventory.findOne({ product: cat.tv.id, branch: KANO }).lean())!.quantity).toBe(40);
  });

  it('a sales staff request can be approved by their branch admin, or rejected without changing stock', async () => {
    const one = (await adjust('kanoSales', -3)).body.data;
    const ok = await as(app, world.sessions.kanoAdmin).post(`/api/v1/inventory/adjustments/${one.id}/approve`, {});
    expect(ok.body.data).toMatchObject({ status: 'applied', reviewedBy: { fullName: 'Kano Admin' } });
    const two = (await adjust('kanoSales', -3)).body.data;
    const no = await as(app, world.sessions.kanoAdmin).post(`/api/v1/inventory/adjustments/${two.id}/reject`, { note: 'Recount' });
    expect(no.body.data.status).toBe('rejected');
    expect((await Inventory.findOne({ product: cat.tv.id, branch: KANO }).lean())!.quantity).toBe(7);
    // Abuja's admin cannot see or review Kano's adjustments.
    expect((await as(app, world.sessions.abujaAdmin).post(`/api/v1/inventory/adjustments/${two.id}/approve`, {})).status).toBe(404);
  });
});

describe('transfers between branches', () => {
  beforeEach(async () => {
    await stockIn(app, world.sessions.kanoAdmin, KANO, cat.tv.id, 10);
  });
  const request = (s: keyof typeof world.sessions, qty = 4) =>
    as(app, world.sessions[s]).post('/api/v1/inventory/transfers', { fromBranch: KANO, toBranch: ABUJA, items: [line(cat.tv.id, qty)], note: 'Abuja needs stock for the weekend' });
  const act = (s: keyof typeof world.sessions, id: string, action: string) => as(app, world.sessions[s]).post(`/api/v1/inventory/transfers/${id}/${action}`, {});
  const qty = async (branch: string) => (await Inventory.findOne({ product: cat.tv.id, branch }).lean())?.quantity ?? 0;

  it('runs request → approve → dispatch → receive, moving stock only at dispatch and receipt', async () => {
    const t = (await request('abujaAdmin')).body.data;
    expect(t).toMatchObject({ status: 'requested', reference: expect.stringMatching(/^TRF-KAN01-/), allowedActions: ['cancel'] });

    expect((await act('kanoAdmin', t.id, 'dispatch')).status).toBe(409); // not approved yet
    expect((await act('superAdmin', t.id, 'approve')).body.data.status).toBe('approved');
    expect(await qty(KANO)).toBe(10);

    expect((await act('abujaAdmin', t.id, 'dispatch')).status).toBe(403); // only the source branch dispatches
    const dispatched = await act('kanoAdmin', t.id, 'dispatch');
    expect(dispatched.body.data.status).toBe('in_transit');
    expect(await qty(KANO)).toBe(6);
    expect(await qty(ABUJA)).toBe(0);

    expect((await act('kanoAdmin', t.id, 'receive')).status).toBe(403); // only the destination receives
    expect((await act('kanoAdmin', t.id, 'cancel')).status).toBe(409); // too late to cancel
    const received = await act('abujaAdmin', t.id, 'receive');
    expect(received.body.data.status).toBe('received');
    expect(received.body.data.history.map((h: { status: string }) => h.status)).toEqual(['requested', 'approved', 'in_transit', 'received']);
    expect(await qty(ABUJA)).toBe(4);

    const ledger = await InventoryMovement.find({ 'reference.kind': 'StockTransfer' }).lean();
    expect(ledger.map((m) => [m.type, m.quantityDelta]).sort()).toEqual([['transfer_in', 4], ['transfer_out', -4]]);
  });

  it('fails the dispatch, and leaves everything unchanged, when the source no longer has the stock', async () => {
    const t = (await request('superAdmin', 8)).body.data; // head office requests are pre-approved
    expect(t.status).toBe('approved');
    await as(app, world.sessions.kanoAdmin).post('/api/v1/inventory/stock-out', { branch: KANO, items: [line(cat.tv.id, 5)], reason: 'damaged' });
    const res = await act('kanoAdmin', t.id, 'dispatch');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await as(app, world.sessions.kanoAdmin).get(`/api/v1/inventory/transfers/${t.id}`)).body.data.status).toBe('approved');
    expect(await qty(KANO)).toBe(5);
  });

  it('only head office approves; the requester may cancel before dispatch', async () => {
    const t = (await request('kanoAdmin')).body.data;
    expect((await act('kanoAdmin', t.id, 'approve')).status).toBe(403);
    expect((await act('kanoAdmin', t.id, 'cancel')).body.data.status).toBe('cancelled');
  });

  it('sales staff cannot request transfers, and other branches cannot see them', async () => {
    expect((await request('kanoSales')).status).toBe(403);
    const t = (await request('kanoAdmin')).body.data;
    const third = await as(app, world.sessions.superAdmin).post('/api/v1/branches', {
      name: 'Kano 2', code: 'KAN02', address: 'x', city: 'Kano', state: 'Kano', phone: '08030000002', whatsapp: '08030000002',
    });
    expect(third.status).toBe(201);
    // Abuja is the destination, so it sees the transfer.
    expect((await as(app, world.sessions.abujaAdmin).get('/api/v1/inventory/transfers')).body.data.map((x: { id: string }) => x.id)).toEqual([t.id]);
  });
});
