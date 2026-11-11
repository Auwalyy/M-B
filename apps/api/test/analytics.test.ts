import { randomUUID } from 'node:crypto';
import { addDays, lagosDay } from '@mb/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/audit.model';
import { Order } from '../src/modules/commerce/commerce.models';
import { as, makeApp, makeCatalog, makeWorld, stockIn } from './helpers';

/**
 * Report figures reconciled against a known set of sales:
 *   A  Kano   1 TV  paid in full, completed       (customer "Shared Buyer")
 *   B  Kano   1 TV  10,000 naira paid, still confirmed
 *   C  Kano   1 TV  cancelled (never a sale)
 *   D  Abuja  1 TV  paid in full, completed       (same customer as A)
 * TV price ₦600,000, cost ₦500,000. Opening stock: Kano 5, Abuja 3.
 */
const app = makeApp();
const TV = 60_000_000;
const COST = 50_000_000;
const PART = 1_000_000;
let world: Awaited<ReturnType<typeof makeWorld>>;
let cat: Awaited<ReturnType<typeof makeCatalog>>;
let KANO: string;
let ABUJA: string;
let orders: Record<'A' | 'B' | 'C' | 'D', { id: string; payment?: string }>;

type S = keyof typeof world.sessions;
const get = (s: S, url: string) => as(app, world.sessions[s]).get(`/api/v1${url}`);

async function sale(branch: string, seller: S, admin: S, opts: { name: string; phone: string; pay?: number; complete?: boolean; cancel?: boolean }) {
  const api = as(app, world.sessions[seller]);
  const res = await api.post('/api/v1/orders', {
    branch, channel: 'in_store', contact: { fullName: opts.name, phone: opts.phone }, items: [{ product: cat.tv.id, quantity: 1 }],
    fulfilment: 'pickup', paymentMethod: 'cash', idempotencyKey: randomUUID(),
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  const id = res.body.data.id as string;
  let payment: string | undefined;
  if (opts.pay) payment = (await api.post('/api/v1/payments', { order: id, method: 'cash', amount: opts.pay })).body.data.id;
  const adm = as(app, world.sessions[admin]);
  if (opts.complete) for (const to of ['processing', 'ready_for_pickup', 'completed']) expect((await adm.post(`/api/v1/orders/${id}/status`, { to })).status).toBe(200);
  if (opts.cancel) expect((await adm.post(`/api/v1/orders/${id}/cancel`, { reason: 'Changed mind' })).status).toBe(200);
  return { id, payment };
}

beforeEach(async () => {
  world = await makeWorld(app);
  cat = await makeCatalog(app, world.sessions.superAdmin);
  KANO = world.branches.kano._id.toString();
  ABUJA = world.branches.abuja._id.toString();
  await stockIn(app, world.sessions.kanoAdmin, KANO, cat.tv.id, 5);
  await stockIn(app, world.sessions.abujaAdmin, ABUJA, cat.tv.id, 3);
  orders = {
    A: await sale(KANO, 'kanoSales', 'kanoAdmin', { name: 'Shared Buyer', phone: '08030000001', pay: TV, complete: true }),
    B: await sale(KANO, 'kanoSales', 'kanoAdmin', { name: 'Part Payer', phone: '08030000002', pay: PART }),
    C: await sale(KANO, 'kanoSales', 'kanoAdmin', { name: 'Cancelled Buyer', phone: '08030000003', cancel: true }),
    D: await sale(ABUJA, 'abujaSales', 'abujaAdmin', { name: 'Shared Buyer', phone: '08030000001', pay: TV, complete: true }),
  };
});

describe('analytics overview', () => {
  it('reconciles company-wide figures with the defined metrics', async () => {
    const res = await get('superAdmin', '/analytics/overview');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.range).toEqual({ from: addDays(lagosDay(), -29), to: lagosDay() });
    expect(d.access).toEqual({ financial: true, cost: true });
    expect(d.branchCount).toBe(2);
    expect(d.sales.grossSales.value).toBe(3 * TV); // A, B, D; C was cancelled
    expect(d.sales.orders.value).toBe(3);
    expect(d.sales.averageOrderValue.value).toBe(TV);
    expect(d.sales.unitsSold.value).toBe(2); // completed orders only
    expect(d.financial).toMatchObject({
      collectedRevenue: { value: 2 * TV + PART, previous: 0 },
      refunds: { value: 0 },
      outstandingBalance: TV - PART,
      ordersWithBalance: 1,
    });
    // Kano 5 − 1 sold = 4 on hand (B's unit is held, not sold); Abuja 3 − 1 = 2.
    expect(d.inventory).toMatchObject({ units: 6, value: 6 * COST, linesWithoutCost: 0 });
    expect(d.operations).toMatchObject({ pendingOrders: 0, ordersInProgress: 1 });
    expect(d.customers.total).toBe(3);
  });

  it('limits a branch admin to their own branch and hides other branches', async () => {
    const d = (await get('kanoAdmin', '/analytics/overview')).body.data;
    expect(d.branchCount).toBe(1);
    expect(d.sales.grossSales.value).toBe(2 * TV);
    expect(d.sales.unitsSold.value).toBe(1);
    expect(d.financial.collectedRevenue.value).toBe(TV + PART);
    expect(d.inventory.value).toBe(4 * COST);

    // Another branch looks the same as one that does not exist.
    expect((await get('kanoAdmin', `/analytics/overview?branch=${ABUJA}`)).status).toBe(404);
    expect((await get('kanoAdmin', `/analytics/branch/${ABUJA}/overview`)).status).toBe(404);
    const own = await get('kanoAdmin', `/analytics/branch/${KANO}/overview`);
    expect(own.body.data.branch).toMatchObject({ code: 'KAN01' });

    const perf = (await get('kanoAdmin', '/analytics/branches/performance')).body.data;
    expect(perf.branches.map((b: { branch: { code: string } }) => b.branch.code)).toEqual(['KAN01']);
  });

  it('keeps reports away from sales staff', async () => {
    for (const url of ['/analytics/overview', '/analytics/sales', '/reports/sales', '/reports/payments', '/reports/inventory']) {
      expect((await get('kanoSales', url)).status).toBe(403);
    }
  });

  it('compares with the previous period of the same length', async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await Order.collection.updateOne({ _id: (await Order.findById(orders.D.id))!._id }, { $set: { confirmedAt: old } });
    const d = (await get('superAdmin', '/analytics/overview')).body.data;
    expect(d.sales.grossSales).toEqual({ value: 2 * TV, previous: TV });
    expect(d.previousRange).toEqual({ from: addDays(lagosDay(), -59), to: addDays(lagosDay(), -30) });
  });

  it('subtracts processed refunds from collected revenue on the refund date', async () => {
    const refund = await as(app, world.sessions.kanoAdmin).post(`/api/v1/payments/${orders.A.payment}/refunds`, { amount: PART, reason: 'Scratched' });
    expect(refund.status).toBe(201);
    const d = (await get('superAdmin', '/analytics/overview')).body.data;
    expect(d.financial.refunds.value).toBe(PART);
    expect(d.financial.collectedRevenue.value).toBe(2 * TV);
    // A partial refund on a completed sale is a return, not money owed.
    expect(d.financial.outstandingBalance).toBe(TV - PART);
  });

  it('validates the date range', async () => {
    expect((await get('superAdmin', '/analytics/overview?from=2026-05-10&to=2026-05-01')).status).toBe(422);
    expect((await get('superAdmin', '/analytics/overview?from=2020-01-01&to=2026-01-01')).status).toBe(422);
    expect((await get('superAdmin', '/analytics/overview?from=2026-02-31')).status).toBe(422);
  });
});

describe('charts and lists', () => {
  it('builds a filled daily series whose totals match the overview', async () => {
    const d = (await get('superAdmin', '/analytics/sales?groupBy=day')).body.data;
    expect(d.points).toHaveLength(30);
    expect(d.points.at(-1)).toMatchObject({ period: lagosDay(), grossSales: 3 * TV, orders: 3, collectedRevenue: 2 * TV + PART });
    expect(d.totals).toEqual({ grossSales: 3 * TV, orders: 3, collectedRevenue: 2 * TV + PART });

    const monthly = (await get('superAdmin', `/analytics/sales?groupBy=month&from=${lagosDay().slice(0, 7)}-01`)).body.data;
    expect(monthly.points).toHaveLength(1);
    expect(monthly.points[0].period).toBe(`${lagosDay().slice(0, 7)}-01`);
  });

  it('ranks best sellers from completed orders in scope', async () => {
    const all = (await get('superAdmin', '/analytics/top-products')).body.data.products;
    expect(all).toEqual([expect.objectContaining({ product: expect.objectContaining({ sku: 'SAM-TV-001' }), unitsSold: 2, revenue: 2 * TV, orders: 2 })]);
    const kano = (await get('kanoAdmin', '/analytics/top-products?by=units')).body.data.products;
    expect(kano[0]).toMatchObject({ unitsSold: 1, revenue: TV });
  });

  it('lists recent orders and payments within scope', async () => {
    const d = (await get('kanoAdmin', '/analytics/recent-transactions?limit=10')).body.data;
    expect(d.orders).toHaveLength(3);
    expect(d.orders.every((o: { branch: { code: string } }) => o.branch.code === 'KAN01')).toBe(true);
    expect(d.payments).toHaveLength(2);
  });

  it('compares branches with shares that add up', async () => {
    const d = (await get('superAdmin', '/analytics/branches/performance')).body.data;
    const kano = d.branches.find((b: { branch: { code: string } }) => b.branch.code === 'KAN01');
    const abuja = d.branches.find((b: { branch: { code: string } }) => b.branch.code === 'ABJ01');
    expect(kano).toMatchObject({ grossSales: 2 * TV, orders: 2, unitsSold: 1, collectedRevenue: TV + PART, outstandingBalance: TV - PART, inventoryValue: 4 * COST });
    expect(abuja).toMatchObject({ grossSales: TV, collectedRevenue: TV, outstandingBalance: 0 });
    expect(kano.shareOfSales + abuja.shareOfSales).toBeCloseTo(1);
  });
});

describe('reports', () => {
  it('sales report summary matches the overview and pages through rows', async () => {
    const d = (await get('superAdmin', '/reports/sales?limit=2')).body.data;
    expect(d.summary).toMatchObject({ orders: 3, grossSales: 3 * TV, units: 3, paidOnOrders: 2 * TV + PART, outstanding: TV - PART });
    expect(d.summary.byChannel).toEqual([{ channel: 'in_store', orders: 3, grossSales: 3 * TV }]);
    expect(d.rows).toHaveLength(2);
    expect(d).toMatchObject({ total: 3, pages: 2, page: 1 });
  });

  it('exports CSV for the caller\'s branch only and records the export', async () => {
    const res = await get('kanoAdmin', '/reports/sales?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="sales-all-/);
    const lines = res.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toMatch(/^Order,Confirmed \(Lagos\),Branch/);
    expect(lines).toHaveLength(3); // header + A + B
    expect(lines.slice(1).every((l) => l.includes(',KAN01,'))).toBe(true);
    expect(lines.join('\n')).toContain('600000.00');
    expect(await AuditLog.countDocuments({ action: 'report.exported' })).toBe(1);
  });

  it('neutralises spreadsheet formulas in exported text', async () => {
    await sale(KANO, 'kanoSales', 'kanoAdmin', { name: '=HYPERLINK("http://x")', phone: '08030000009' });
    const res = await get('kanoAdmin', '/reports/sales?format=csv');
    expect(res.text).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  it('inventory report values stock at cost and retail, and filters alerts', async () => {
    const d = (await get('superAdmin', '/reports/inventory')).body.data;
    expect(d.summary).toMatchObject({ lines: 2, units: 6, reserved: 1, costValue: 6 * COST, retailValue: 6 * TV });
    expect(d.rows[0]).toMatchObject({ sku: 'SAM-TV-001', unitPrice: TV, costPrice: COST });
    const kano = (await get('kanoAdmin', '/reports/inventory')).body.data;
    expect(kano.rows.map((r: { branch: { code: string } }) => r.branch.code)).toEqual(['KAN01']);
    const out = (await get('superAdmin', '/reports/inventory?stock=out')).body.data;
    expect(out.summary.lines).toBe(0);
  });

  it('customer report counts only spending in the caller\'s branches', async () => {
    const all = (await get('superAdmin', '/reports/customers')).body.data;
    expect(all.rows[0]).toMatchObject({ fullName: 'Shared Buyer', orders: 2, spent: 2 * TV, branches: ['ABJ01', 'KAN01'], isNew: true });
    expect(all.summary).toMatchObject({ customers: 2, orders: 3, spent: 3 * TV, repeatCustomers: 1, newCustomers: 2 });

    const kano = (await get('kanoAdmin', '/reports/customers')).body.data;
    const shared = kano.rows.find((r: { fullName: string }) => r.fullName === 'Shared Buyer');
    expect(shared).toMatchObject({ orders: 1, spent: TV, branches: ['KAN01'] });
    const abuja = (await get('abujaAdmin', '/reports/customers')).body.data;
    expect(abuja.rows.map((r: { fullName: string }) => r.fullName)).toEqual(['Shared Buyer']);
  });

  it('payment report totals verified payments and refunds by method', async () => {
    await as(app, world.sessions.abujaAdmin).post(`/api/v1/payments/${orders.D.payment}/refunds`, { amount: PART, reason: 'Goodwill' });
    const d = (await get('superAdmin', '/reports/payments')).body.data;
    expect(d.summary).toMatchObject({ payments: 3, received: 2 * TV + PART, refunds: PART, collectedRevenue: 2 * TV });
    expect(d.summary.byMethod).toEqual([{ method: 'cash', payments: 3, amount: 2 * TV + PART }]);
    const refunded = d.rows.find((r: { refunded: number }) => r.refunded > 0);
    expect(refunded).toMatchObject({ refunded: PART, verifiedBy: expect.any(String), orderReference: expect.stringMatching(/^ORD-ABJ01-/) });

    const kano = (await get('kanoAdmin', '/reports/payments?format=csv')).text;
    expect(kano).not.toContain('ABJ01');
  });
});
