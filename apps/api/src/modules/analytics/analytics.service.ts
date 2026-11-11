import {
  type AnalyticsOverviewDto,
  type BranchPerformanceReportDto,
  type BranchRef,
  type InventoryDto,
  type Kpi,
  type RecentTransactionsDto,
  type ReportGrouping,
  type SalesPointDto,
  type SalesSeriesDto,
  type TopProductsDto,
  BUSINESS_TIMEZONE,
  addDays,
  listInventoryQuery,
} from '@mb/shared';
import type { Types } from 'mongoose';
import type { AuthContext } from '../../core/auth/AuthContext';
import { Branch } from '../branches/branch.model';
import { Product } from '../catalog/catalog.models';
import { Order } from '../commerce/commerce.models';
import { Enquiry } from '../customers/crm.models';
import { Customer } from '../customers/customer.model';
import { listInventory } from '../inventory/inventory.service';
import { Delivery, Payment, Reservation } from '../transactions/transactions.models';
import {
  OPEN_STATUSES,
  collectedByBranch,
  inventoryByBranch,
  outstandingByBranch,
  salesByBranch,
  salesMatch,
  sumOf,
  unitsByBranch,
} from './metrics';
import { type ReportScope, type ResolvedRange, plainRange, previousRange, resolveRange, resolveScope, scopeMatch } from './scope';

type RangeQuery = { from?: string; to?: string; branch?: string };

const kpi = (value: number, previous: number): Kpi => ({ value, previous });
const avg = (total: number, count: number) => (count ? Math.round(total / count) : 0);
const ref = (b: { _id: Types.ObjectId; name: string; code: string }): BranchRef => ({ id: b._id.toString(), name: b.name, code: b.code });

async function salesFigures(scope: ReportScope, r: ResolvedRange) {
  const [sales, units] = await Promise.all([salesByBranch(scope, r), unitsByBranch(scope, r)]);
  const gross = sumOf(sales, 'grossSales');
  const orders = sumOf(sales, 'orders');
  return { gross, orders, aov: avg(gross, orders), units: sumOf(units, 'units') };
}

async function collectedFigures(scope: ReportScope, r: ResolvedRange) {
  const c = await collectedByBranch(scope, r);
  return { collected: sumOf(c, 'collected'), refunds: sumOf(c, 'refunds') };
}


/** Headline figures for the dashboard: the company, the caller's branches, or one branch. */
export async function overview(auth: AuthContext, q: RangeQuery): Promise<AnalyticsOverviewDto> {
  const scope = await resolveScope(auth, q.branch);
  const range = resolveRange(q);
  const prev = previousRange(range);
  const branchMatch = scopeMatch(scope);
  const customerMatch = scope.branchIds === 'ALL' ? {} : { branchesServed: { $in: scope.branchIds } };

  const [now, before, money, moneyBefore, outstanding, inventory, ops, customers, newCustomers, newBefore, activeProducts, branchCount] = await Promise.all([
    salesFigures(scope, range),
    salesFigures(scope, prev),
    scope.financial ? collectedFigures(scope, range) : null,
    scope.financial ? collectedFigures(scope, prev) : null,
    scope.financial ? outstandingByBranch(scope) : null,
    inventoryByBranch(scope),
    Promise.all([
      Order.countDocuments({ ...branchMatch, status: 'pending' }),
      Order.countDocuments({ ...branchMatch, status: { $in: OPEN_STATUSES } }),
      Reservation.countDocuments({ ...branchMatch, status: { $in: ['pending', 'confirmed'] } }),
      // Card payments start as pending until Paystack answers, so only staff-recorded payments wait for review.
      Payment.countDocuments({ ...branchMatch, status: 'pending', method: { $ne: 'paystack' } }),
      Delivery.countDocuments({ ...branchMatch, status: { $in: ['pending', 'assigned', 'picked_up', 'in_transit'] } }),
      Enquiry.countDocuments({ ...branchMatch, status: { $in: ['new', 'in_progress'] } }),
    ]),
    Customer.countDocuments(customerMatch),
    Customer.countDocuments({ ...customerMatch, createdAt: { $gte: range.start, $lt: range.end } }),
    Customer.countDocuments({ ...customerMatch, createdAt: { $gte: prev.start, $lt: prev.end } }),
    Product.countDocuments({ status: 'active' }),
    scope.branchIds === 'ALL' ? Branch.countDocuments({ status: 'active' }) : Promise.resolve(scope.branchIds.length),
  ]);

  return {
    range: plainRange(range),
    previousRange: plainRange(prev),
    branch: scope.branch,
    branchCount,
    access: { financial: scope.financial, cost: scope.cost },
    sales: {
      grossSales: kpi(now.gross, before.gross),
      orders: kpi(now.orders, before.orders),
      averageOrderValue: kpi(now.aov, before.aov),
      unitsSold: kpi(now.units, before.units),
    },
    financial:
      money && moneyBefore && outstanding
        ? {
            collectedRevenue: kpi(money.collected, moneyBefore.collected),
            refunds: kpi(money.refunds, moneyBefore.refunds),
            outstandingBalance: sumOf(outstanding, 'outstanding'),
            ordersWithBalance: sumOf(outstanding, 'orders'),
          }
        : null,
    inventory: {
      value: scope.cost ? sumOf(inventory, 'value') : null,
      linesWithoutCost: sumOf(inventory, 'withoutCost'),
      units: sumOf(inventory, 'units'),
      lowStock: sumOf(inventory, 'low'),
      outOfStock: sumOf(inventory, 'out'),
    },
    operations: {
      pendingOrders: ops[0],
      ordersInProgress: ops[1],
      openReservations: ops[2],
      paymentsAwaitingReview: ops[3],
      activeDeliveries: ops[4],
      openEnquiries: ops[5],
    },
    customers: { total: customers, new: kpi(newCustomers, newBefore) },
    activeProducts,
  };
}

/** Side-by-side figures for every branch in scope. */
export async function branchPerformance(auth: AuthContext, q: RangeQuery): Promise<BranchPerformanceReportDto> {
  const scope = await resolveScope(auth, q.branch);
  const range = resolveRange(q);
  const branchFilter = scope.branchIds === 'ALL' ? {} : { _id: { $in: scope.branchIds } };
  const [branches, sales, units, collected, outstanding, inventory] = await Promise.all([
    Branch.find(branchFilter).select('name code city status').sort({ status: 1, name: 1 }).lean(),
    salesByBranch(scope, range),
    unitsByBranch(scope, range),
    scope.financial ? collectedByBranch(scope, range) : null,
    scope.financial ? outstandingByBranch(scope) : null,
    inventoryByBranch(scope),
  ]);
  const totalGross = sumOf(sales, 'grossSales');
  return {
    range: plainRange(range),
    access: { financial: scope.financial, cost: scope.cost },
    branches: branches
      .map((b) => {
        const id = b._id.toString();
        const s = sales.get(id);
        const inv = inventory.get(id);
        const gross = s?.grossSales ?? 0;
        return {
          branch: { ...ref(b), city: b.city, status: b.status },
          grossSales: gross,
          orders: s?.orders ?? 0,
          averageOrderValue: avg(gross, s?.orders ?? 0),
          unitsSold: units.get(id)?.units ?? 0,
          shareOfSales: totalGross ? gross / totalGross : 0,
          collectedRevenue: collected ? (collected.get(id)?.collected ?? 0) : null,
          outstandingBalance: outstanding ? (outstanding.get(id)?.outstanding ?? 0) : null,
          inventoryValue: scope.cost ? (inv?.value ?? 0) : null,
          lowStock: (inv?.low ?? 0) + (inv?.out ?? 0),
        };
      })
      .sort((a, b) => b.grossSales - a.grossSales),
  };
}

// ------------------------------------------------------------------ Time series

function bucketStart(day: string, unit: ReportGrouping): string {
  if (unit === 'day') return day;
  if (unit === 'month') return `${day.slice(0, 7)}-01`;
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7)); // back to Monday
}

function nextBucket(day: string, unit: ReportGrouping): string {
  if (unit === 'day') return addDays(day, 1);
  if (unit === 'week') return addDays(day, 7);
  const [y, m] = day.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

const bucketOf = (field: string, unit: ReportGrouping) => ({
  $dateToString: {
    format: '%Y-%m-%d',
    timezone: BUSINESS_TIMEZONE,
    date: { $dateTrunc: { date: field, unit, timezone: BUSINESS_TIMEZONE, startOfWeek: 'monday' } },
  },
});

async function series<T>(model: typeof Order | typeof Payment, pipeline: object[]): Promise<Map<string, T>> {
  const rows = (await (model as typeof Order).aggregate(pipeline as never).exec()) as ({ _id: string } & T)[];
  return new Map(rows.map(({ _id, ...rest }) => [_id, rest as T]));
}

/** Gross sales (and collected revenue) per day, week or month, with empty periods filled in. */
export async function salesSeries(auth: AuthContext, q: RangeQuery & { groupBy: ReportGrouping }): Promise<SalesSeriesDto> {
  const scope = await resolveScope(auth, q.branch);
  const range = resolveRange(q);
  const unit = q.groupBy;
  const between = { $gte: range.start, $lt: range.end };
  const [sales, received, refunds] = await Promise.all([
    series<{ grossSales: number; orders: number }>(Order, [
      { $match: salesMatch(scope, range) },
      { $group: { _id: bucketOf('$confirmedAt', unit), grossSales: { $sum: '$total' }, orders: { $sum: 1 } } },
    ]),
    scope.financial
      ? series<{ amount: number }>(Payment, [
          { $match: { ...scopeMatch(scope), status: 'success', verifiedAt: between } },
          { $group: { _id: bucketOf('$verifiedAt', unit), amount: { $sum: '$amount' } } },
        ])
      : null,
    scope.financial
      ? series<{ amount: number }>(Payment, [
          { $match: { ...scopeMatch(scope), refunds: { $elemMatch: { status: 'processed', at: between } } } },
          { $unwind: '$refunds' },
          { $match: { 'refunds.status': 'processed', 'refunds.at': between } },
          { $group: { _id: bucketOf('$refunds.at', unit), amount: { $sum: '$refunds.amount' } } },
        ])
      : null,
  ]);

  const points: SalesPointDto[] = [];
  for (let p = bucketStart(range.from, unit); p <= range.to; p = nextBucket(p, unit)) {
    const s = sales.get(p);
    points.push({
      period: p,
      grossSales: s?.grossSales ?? 0,
      orders: s?.orders ?? 0,
      collectedRevenue: received && refunds ? (received.get(p)?.amount ?? 0) - (refunds.get(p)?.amount ?? 0) : null,
    });
  }
  return {
    range: plainRange(range),
    groupBy: unit,
    access: { financial: scope.financial, cost: scope.cost },
    points,
    totals: {
      grossSales: points.reduce((n, p) => n + p.grossSales, 0),
      orders: points.reduce((n, p) => n + p.orders, 0),
      collectedRevenue: scope.financial ? points.reduce((n, p) => n + (p.collectedRevenue ?? 0), 0) : null,
    },
  };
}

// ------------------------------------------------------------------ Lists

/** Best sellers on completed orders (the units-sold metric). */
export async function topProducts(auth: AuthContext, q: RangeQuery & { by: 'revenue' | 'units'; limit: number }): Promise<TopProductsDto> {
  const scope = await resolveScope(auth, q.branch);
  const range = resolveRange(q);
  const rows = await Order.aggregate<{ _id: Types.ObjectId; units: number; revenue: number; orders: number }>([
    { $match: { ...scopeMatch(scope), status: 'completed', completedAt: { $gte: range.start, $lt: range.end } } },
    { $unwind: '$items' },
    // Per order first, so an order with two sizes of one product counts once.
    { $group: { _id: { product: '$items.product', order: '$_id' }, units: { $sum: '$items.quantity' }, revenue: { $sum: '$items.lineTotal' } } },
    { $group: { _id: '$_id.product', units: { $sum: '$units' }, revenue: { $sum: '$revenue' }, orders: { $sum: 1 } } },
    { $sort: q.by === 'units' ? { units: -1, revenue: -1, _id: 1 } : { revenue: -1, units: -1, _id: 1 } },
    { $limit: q.limit },
  ]);
  const products = await Product.find({ _id: { $in: rows.map((r) => r._id) } }).select('name slug sku').lean();
  const byId = new Map(products.map((p) => [p._id.toString(), p]));
  return {
    range: plainRange(range),
    by: q.by,
    products: rows.map((r) => {
      const p = byId.get(r._id.toString());
      return {
        product: { id: r._id.toString(), name: p?.name ?? 'Deleted product', slug: p?.slug ?? '', sku: p?.sku ?? '' },
        unitsSold: r.units,
        revenue: r.revenue,
        orders: r.orders,
      };
    }),
  };
}

/** Lines at or below their reorder level (out of stock first). Uses the inventory module's own scoping. */
export async function lowStock(auth: AuthContext, q: { branch?: string; limit: number }): Promise<InventoryDto[]> {
  if (q.branch) await resolveScope(auth, q.branch);
  const page = await listInventory(auth, listInventoryQuery.parse({ branch: q.branch, lowStock: true, limit: q.limit }));
  return page.items;
}

export async function recentTransactions(auth: AuthContext, q: { branch?: string; limit: number }): Promise<RecentTransactionsDto> {
  const scope = await resolveScope(auth, q.branch);
  type B = { _id: Types.ObjectId; name: string; code: string };
  const [orders, payments] = await Promise.all([
    Order.find(scopeMatch(scope))
      .sort({ createdAt: -1 })
      .limit(q.limit)
      .select('reference branch contact.fullName channel total status paymentStatus createdAt')
      .populate<{ branch: B }>('branch', 'name code')
      .lean(),
    scope.financial
      ? Payment.find({ ...scopeMatch(scope), status: 'success' })
          .sort({ verifiedAt: -1 })
          .limit(q.limit)
          .select('reference receiptNumber order branch method amount verifiedAt')
          .populate<{ branch: B }>('branch', 'name code')
          .populate<{ order: { _id: Types.ObjectId; reference: string } }>('order', 'reference')
          .lean()
      : null,
  ]);
  return {
    orders: orders.map((o) => ({
      id: o._id.toString(),
      reference: o.reference,
      branch: ref(o.branch),
      customerName: o.contact.fullName,
      channel: o.channel,
      total: o.total,
      status: o.status,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt.toISOString(),
    })),
    payments:
      payments?.map((p) => ({
        id: p._id.toString(),
        reference: p.reference,
        receiptNumber: p.receiptNumber ?? null,
        orderId: p.order._id.toString(),
        orderReference: p.order.reference,
        branch: ref(p.branch),
        method: p.method,
        amount: p.amount,
        verifiedAt: (p.verifiedAt ?? new Date(0)).toISOString(),
      })) ?? null,
  };
}
