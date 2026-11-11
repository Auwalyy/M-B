import {
  type BranchRef,
  CSV_MAX_ROWS,
  type CustomerReportRow,
  type CustomerReportSummary,
  type InventoryReportRow,
  type InventoryReportSummary,
  type OrderChannel,
  type PaymentMethod,
  type PaymentReportRow,
  type PaymentReportSummary,
  type ReportPage,
  type SalesReportRow,
  type SalesReportSummary,
  type customersReportQuery,
  type inventoryReportQuery,
  type paymentsReportQuery,
  type salesReportQuery,
} from '@mb/shared';
import type { Response } from 'express';
import type { PipelineStage, Types } from 'mongoose';
import type { z } from 'zod';
import type { AuthContext } from '../../core/auth/AuthContext';
import { forbidden } from '../../core/errors/AppError';
import { type CsvCell, lagosDateTime, naira, sendCsv } from '../../core/http/csv';
import { escapeRegex } from '../../core/http/pagination';
import type { RequestMeta } from '../../core/http/route';
import { audit } from '../audit/audit.service';
import { Branch } from '../branches/branch.model';
import { Order } from '../commerce/commerce.models';
import { variantLabel } from '../catalog/catalog.models';
import { Inventory } from '../inventory/inventory.models';
import { getSettingsDoc } from '../settings/settings.service';
import { Payment } from '../transactions/transactions.models';
import { salesMatch } from './metrics';
import { type ReportScope, type ResolvedRange, plainRange, resolveRange, resolveScope, scopeMatch } from './scope';

/**
 * Detailed reports. Each one answers JSON (a page of rows plus a summary of the whole range)
 * or CSV (every row, up to CSV_MAX_ROWS). Exports are recorded in the activity log.
 */

type Out = { res: Response; meta: RequestMeta };

async function branchRefs(scope: ReportScope): Promise<Map<string, BranchRef>> {
  const rows = await Branch.find(scope.branchIds === 'ALL' ? {} : { _id: { $in: scope.branchIds } }).select('name code').lean();
  return new Map(rows.map((b) => [b._id.toString(), { id: b._id.toString(), name: b.name, code: b.code }]));
}

const unknownBranch = (id: unknown): BranchRef => ({ id: String(id), name: 'Unknown branch', code: '—' });

function pageOf<Row, Summary>(range: ResolvedRange | null, summary: Summary, rows: Row[], total: number, page: number, limit: number): ReportPage<Row, Summary> {
  return { range: range ? plainRange(range) : null, summary, rows, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

async function exported(auth: AuthContext, scope: ReportScope, report: string, range: ResolvedRange | null, rows: number, meta: RequestMeta) {
  await audit(
    {
      action: 'report.exported',
      actor: auth,
      branch: scope.branch?.id ?? null,
      entity: { kind: 'Report', label: `${report} report${range ? ` ${range.from} to ${range.to}` : ''}` },
      after: { report, ...(range ? plainRange(range) : {}), branch: scope.branch?.code ?? 'all in scope', rows },
    },
    meta,
  );
}

const fileName = (report: string, scope: ReportScope, range: ResolvedRange | null) =>
  `${report}-${scope.branch?.code ?? 'all'}${range ? `-${range.from}-to-${range.to}` : ''}.csv`;

const facetPage = (sort: Record<string, 1 | -1>, page: number, limit: number): PipelineStage.FacetPipelineStage[] => [
  { $sort: sort },
  { $skip: (page - 1) * limit },
  { $limit: limit },
];

// ------------------------------------------------------------------ Sales

type SalesQuery = z.output<typeof salesReportQuery>;

interface SalesDoc {
  _id: Types.ObjectId;
  reference: string;
  confirmedAt: Date;
  branch: Types.ObjectId;
  channel: OrderChannel;
  contact: { fullName: string; phone: string };
  units: number;
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  total: number;
  amountPaid: number;
  status: SalesReportRow['status'];
  paymentStatus: string;
  paymentMethod: PaymentMethod;
  fulfilment: { method: 'pickup' | 'delivery' };
}

const SALES_PROJECTION = {
  reference: 1, confirmedAt: 1, branch: 1, channel: 1, contact: 1, subtotal: 1, discountTotal: 1, deliveryFee: 1,
  total: 1, amountPaid: 1, status: 1, paymentStatus: 1, paymentMethod: 1, 'fulfilment.method': 1, units: { $sum: '$items.quantity' },
};

export async function salesReport(auth: AuthContext, q: SalesQuery, out: Out): Promise<ReportPage<SalesReportRow, SalesReportSummary> | undefined> {
  const scope = await resolveScope(auth, q.branch);
  const range = resolveRange(q);
  const match = { ...salesMatch(scope, range), ...(q.channel ? { channel: q.channel } : {}) };
  const branches = await branchRefs(scope);
  const toRow = (o: SalesDoc): SalesReportRow => ({
    id: o._id.toString(),
    reference: o.reference,
    confirmedAt: o.confirmedAt.toISOString(),
    branch: branches.get(o.branch.toString()) ?? unknownBranch(o.branch),
    channel: o.channel,
    customerName: o.contact.fullName,
    customerPhone: o.contact.phone,
    units: o.units,
    subtotal: o.subtotal,
    discount: o.discountTotal,
    deliveryFee: o.deliveryFee,
    total: o.total,
    amountPaid: o.amountPaid,
    outstanding: o.status === 'completed' ? 0 : Math.max(0, o.total - o.amountPaid),
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    fulfilment: o.fulfilment.method,
  });

  if (q.format === 'csv') {
    const docs = Order.aggregate<SalesDoc>([{ $match: match }, { $sort: { confirmedAt: 1 } }, { $limit: CSV_MAX_ROWS }, { $project: SALES_PROJECTION }]).cursor();
    const count = await sendCsv(
      out.res,
      fileName('sales', scope, range),
      ['Order', 'Confirmed (Lagos)', 'Branch', 'Channel', 'Customer', 'Phone', 'Units', 'Subtotal (NGN)', 'Discount (NGN)', 'Delivery fee (NGN)', 'Total (NGN)', 'Paid (NGN)', 'Outstanding (NGN)', 'Status', 'Payment status', 'Payment method', 'Fulfilment'],
      (async function* () {
        for await (const d of docs) {
          const r = toRow(d);
          yield [r.reference, lagosDateTime(r.confirmedAt), r.branch.code, r.channel, r.customerName, r.customerPhone, r.units, naira(r.subtotal), naira(r.discount), naira(r.deliveryFee), naira(r.total), naira(r.amountPaid), naira(r.outstanding), r.status, r.paymentStatus, r.paymentMethod, r.fulfilment] satisfies CsvCell[];
        }
      })(),
    );
    await exported(auth, scope, 'sales', range, count, out.meta);
    return undefined;
  }

  const [res] = await Order.aggregate<{
    rows: SalesDoc[];
    summary: { orders: number; grossSales: number; discounts: number; deliveryFees: number; units: number; paid: number; outstanding: number }[];
    channels: { _id: OrderChannel; orders: number; grossSales: number }[];
  }>([
    { $match: match },
    {
      $facet: {
        rows: [...facetPage({ confirmedAt: -1, _id: -1 }, q.page, q.limit), { $project: SALES_PROJECTION }],
        summary: [
          {
            $group: {
              _id: null,
              orders: { $sum: 1 },
              grossSales: { $sum: '$total' },
              discounts: { $sum: '$discountTotal' },
              deliveryFees: { $sum: '$deliveryFee' },
              units: { $sum: { $sum: '$items.quantity' } },
              paid: { $sum: '$amountPaid' },
              outstanding: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 0, { $max: [0, { $subtract: ['$total', '$amountPaid'] }] }] } },
            },
          },
        ],
        channels: [{ $group: { _id: '$channel', orders: { $sum: 1 }, grossSales: { $sum: '$total' } } }, { $sort: { grossSales: -1 } }],
      },
    },
  ]);
  const s = res?.summary[0];
  const summary: SalesReportSummary = {
    orders: s?.orders ?? 0,
    grossSales: s?.grossSales ?? 0,
    discounts: s?.discounts ?? 0,
    deliveryFees: s?.deliveryFees ?? 0,
    units: s?.units ?? 0,
    paidOnOrders: s?.paid ?? 0,
    outstanding: s?.outstanding ?? 0,
    byChannel: (res?.channels ?? []).map((c) => ({ channel: c._id, orders: c.orders, grossSales: c.grossSales })),
  };
  return pageOf(range, summary, (res?.rows ?? []).map(toRow), summary.orders, q.page, q.limit);
}

// ------------------------------------------------------------------ Inventory

type InventoryQuery = z.output<typeof inventoryReportQuery>;

interface InventoryDoc {
  _id: Types.ObjectId;
  branch: Types.ObjectId;
  sku: string;
  quantity: number;
  reserved: number;
  available: number;
  reorder: number;
  stock: 'ok' | 'low' | 'out';
  productId: Types.ObjectId;
  productName: string;
  variant: { size?: string; color?: string } | null;
  unitPrice: number;
  cost: number | null;
}

/** Price and cost per stock line, mirroring the storefront's variant pricing rules. */
function inventoryPipeline(scope: ReportScope, q: InventoryQuery, lowStockDefault: number): PipelineStage[] {
  const isVariant = { $eq: [{ $type: '$v' }, 'object'] };
  const pipeline: PipelineStage[] = [
    { $match: scopeMatch(scope) },
    { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'p', pipeline: [{ $project: { name: 1, sku: 1, price: 1, discountPrice: 1, costPrice: 1, variants: 1 } }] } },
    { $unwind: '$p' },
    { $addFields: { v: { $first: { $filter: { input: '$p.variants', cond: { $eq: ['$$this._id', '$variantId'] } } } } } },
    {
      $project: {
        branch: 1,
        sku: 1,
        quantity: 1,
        reserved: 1,
        productId: '$p._id',
        productName: '$p.name',
        productSku: '$p.sku',
        variant: { $cond: [isVariant, { size: '$v.size', color: '$v.color' }, null] },
        available: { $subtract: ['$quantity', '$reserved'] },
        reorder: { $ifNull: ['$reorderLevel', lowStockDefault] },
        cost: { $ifNull: ['$p.costPrice', null] },
        unitPrice: {
          $ifNull: [
            // Sale price: the variant's own, else the product's when the variant has no price of its own.
            {
              $cond: [
                isVariant,
                { $ifNull: ['$v.discountPrice', { $cond: [{ $eq: [{ $ifNull: ['$v.price', null] }, null] }, '$p.discountPrice', null] }] },
                '$p.discountPrice',
              ],
            },
            { $cond: [isVariant, { $ifNull: ['$v.price', '$p.price'] }, '$p.price'] },
          ],
        },
      },
    },
    { $addFields: { stock: { $cond: [{ $lte: ['$available', 0] }, 'out', { $cond: [{ $lte: ['$available', '$reorder'] }, 'low', 'ok'] }] } } },
  ];
  const filter: Record<string, unknown> = {};
  if (q.stock === 'low') filter.stock = { $in: ['low', 'out'] };
  if (q.stock === 'out') filter.stock = 'out';
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ sku: rx }, { productName: rx }, { productSku: rx }];
  }
  if (Object.keys(filter).length) pipeline.push({ $match: filter });
  return pipeline;
}

export async function inventoryReport(auth: AuthContext, q: InventoryQuery, out: Out): Promise<ReportPage<InventoryReportRow, InventoryReportSummary> | undefined> {
  const scope = await resolveScope(auth, q.branch);
  const { lowStockDefault } = await getSettingsDoc();
  const pipeline = inventoryPipeline(scope, q, lowStockDefault);
  const branches = await branchRefs(scope);
  const toRow = (d: InventoryDoc): InventoryReportRow => ({
    id: d._id.toString(),
    branch: branches.get(d.branch.toString()) ?? unknownBranch(d.branch),
    sku: d.sku,
    product: { id: d.productId.toString(), name: d.productName },
    variantLabel: d.variant ? variantLabel(d.variant) : null,
    quantity: d.quantity,
    reserved: d.reserved,
    available: d.available,
    reorderLevel: d.reorder,
    stock: d.stock,
    unitPrice: d.unitPrice,
    retailValue: d.quantity * d.unitPrice,
    costPrice: scope.cost ? d.cost : null,
    costValue: scope.cost && d.cost != null ? d.quantity * d.cost : null,
  });
  // Stock lists sort by most urgent first.
  const sort = { available: 1, sku: 1 } as const;

  if (q.format === 'csv') {
    const docs = Inventory.aggregate<InventoryDoc>([...pipeline, { $sort: sort }, { $limit: CSV_MAX_ROWS }]).cursor();
    const header = ['Branch', 'SKU', 'Product', 'Variant', 'On hand', 'Held', 'Available', 'Reorder level', 'Stock', 'Unit price (NGN)', 'Retail value (NGN)'];
    if (scope.cost) header.push('Unit cost (NGN)', 'Cost value (NGN)');
    const count = await sendCsv(
      out.res,
      fileName('inventory', scope, null),
      header,
      (async function* () {
        for await (const d of docs) {
          const r = toRow(d);
          const cells: CsvCell[] = [r.branch.code, r.sku, r.product.name, r.variantLabel, r.quantity, r.reserved, r.available, r.reorderLevel, r.stock, naira(r.unitPrice), naira(r.retailValue)];
          if (scope.cost) cells.push(naira(r.costPrice), naira(r.costValue));
          yield cells;
        }
      })(),
    );
    await exported(auth, scope, 'inventory', null, count, out.meta);
    return undefined;
  }

  const [res] = await Inventory.aggregate<{
    rows: InventoryDoc[];
    summary: { lines: number; units: number; reserved: number; retailValue: number; costValue: number; withoutCost: number; low: number; out: number }[];
  }>([
    ...pipeline,
    {
      $facet: {
        rows: facetPage(sort, q.page, q.limit),
        summary: [
          {
            $group: {
              _id: null,
              lines: { $sum: 1 },
              units: { $sum: '$quantity' },
              reserved: { $sum: '$reserved' },
              retailValue: { $sum: { $multiply: ['$quantity', '$unitPrice'] } },
              costValue: { $sum: { $multiply: ['$quantity', { $ifNull: ['$cost', 0] }] } },
              withoutCost: { $sum: { $cond: [{ $and: [{ $eq: ['$cost', null] }, { $gt: ['$quantity', 0] }] }, 1, 0] } },
              low: { $sum: { $cond: [{ $eq: ['$stock', 'low'] }, 1, 0] } },
              out: { $sum: { $cond: [{ $eq: ['$stock', 'out'] }, 1, 0] } },
            },
          },
        ],
      },
    },
  ]);
  const s = res?.summary[0];
  const summary: InventoryReportSummary = {
    lines: s?.lines ?? 0,
    units: s?.units ?? 0,
    reserved: s?.reserved ?? 0,
    retailValue: s?.retailValue ?? 0,
    costValue: scope.cost ? (s?.costValue ?? 0) : null,
    linesWithoutCost: s?.withoutCost ?? 0,
    low: s?.low ?? 0,
    out: s?.out ?? 0,
  };
  return pageOf(null, summary, (res?.rows ?? []).map(toRow), summary.lines, q.page, q.limit);
}

// ------------------------------------------------------------------ Customers

type CustomersQuery = z.output<typeof customersReportQuery>;

interface CustomerAgg {
  _id: Types.ObjectId;
  orders: number;
  spent: number;
  firstOrderAt: Date;
  lastOrderAt: Date;
  branches: Types.ObjectId[];
  c: { fullName: string; phone: string; email?: string | null; createdAt: Date } | null;
}

/**
 * Customers who bought in the range, with what they spent in the caller's branches only.
 * Spending at branches outside the caller's scope is never added in.
 */
export async function customersReport(auth: AuthContext, q: CustomersQuery, out: Out): Promise<ReportPage<CustomerReportRow, CustomerReportSummary> | undefined> {
  const scope = await resolveScope(auth, q.branch);
  const range = resolveRange(q);
  const branches = await branchRefs(scope);
  const base: PipelineStage[] = [
    { $match: salesMatch(scope, range) },
    {
      $group: {
        _id: '$customer',
        orders: { $sum: 1 },
        spent: { $sum: '$total' },
        firstOrderAt: { $min: '$confirmedAt' },
        lastOrderAt: { $max: '$confirmedAt' },
        branches: { $addToSet: '$branch' },
      },
    },
  ];
  const lookup: PipelineStage.FacetPipelineStage[] = [
    { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'c', pipeline: [{ $project: { fullName: 1, phone: 1, email: 1, createdAt: 1 } }] } },
    { $addFields: { c: { $first: '$c' } } },
  ];
  const sort: Record<string, 1 | -1> =
    q.sort === 'orders' ? { orders: -1, spent: -1, _id: 1 } : q.sort === 'recent' ? { lastOrderAt: -1, _id: 1 } : { spent: -1, orders: -1, _id: 1 };
  const toRow = (d: CustomerAgg): CustomerReportRow => ({
    id: d._id.toString(),
    fullName: d.c?.fullName ?? 'Unknown customer',
    phone: d.c?.phone ?? '',
    email: d.c?.email ?? null,
    orders: d.orders,
    spent: d.spent,
    averageOrderValue: d.orders ? Math.round(d.spent / d.orders) : 0,
    firstOrderAt: d.firstOrderAt.toISOString(),
    lastOrderAt: d.lastOrderAt.toISOString(),
    branches: d.branches.map((b) => branches.get(b.toString())?.code ?? '—').sort(),
    isNew: !!d.c && d.c.createdAt >= range.start && d.c.createdAt < range.end,
  });

  if (q.format === 'csv') {
    const docs = Order.aggregate<CustomerAgg>([...base, { $sort: sort }, { $limit: CSV_MAX_ROWS }, ...lookup]).cursor();
    const count = await sendCsv(
      out.res,
      fileName('customers', scope, range),
      ['Customer', 'Phone', 'Email', 'Orders', 'Spent (NGN)', 'Average order (NGN)', 'First order (Lagos)', 'Last order (Lagos)', 'Branches', 'New in range'],
      (async function* () {
        for await (const d of docs) {
          const r = toRow(d);
          yield [r.fullName, r.phone, r.email, r.orders, naira(r.spent), naira(r.averageOrderValue), lagosDateTime(r.firstOrderAt), lagosDateTime(r.lastOrderAt), r.branches.join(' '), r.isNew] satisfies CsvCell[];
        }
      })(),
    );
    await exported(auth, scope, 'customers', range, count, out.meta);
    return undefined;
  }

  const [res] = await Order.aggregate<{
    rows: CustomerAgg[];
    summary: { customers: number; orders: number; spent: number; repeat: number }[];
    fresh: { n: number }[];
  }>([
    ...base,
    {
      $facet: {
        rows: [...facetPage(sort, q.page, q.limit), ...lookup],
        summary: [{ $group: { _id: null, customers: { $sum: 1 }, orders: { $sum: '$orders' }, spent: { $sum: '$spent' }, repeat: { $sum: { $cond: [{ $gte: ['$orders', 2] }, 1, 0] } } } }],
        fresh: [...lookup, { $match: { 'c.createdAt': { $gte: range.start, $lt: range.end } } }, { $count: 'n' }],
      },
    },
  ]);
  const s = res?.summary[0];
  const summary: CustomerReportSummary = {
    customers: s?.customers ?? 0,
    orders: s?.orders ?? 0,
    spent: s?.spent ?? 0,
    newCustomers: res?.fresh[0]?.n ?? 0,
    repeatCustomers: s?.repeat ?? 0,
  };
  return pageOf(range, summary, (res?.rows ?? []).map(toRow), summary.customers, q.page, q.limit);
}

// ------------------------------------------------------------------ Payments

type PaymentsQuery = z.output<typeof paymentsReportQuery>;

interface PaymentAgg {
  _id: Types.ObjectId;
  reference: string;
  receiptNumber?: string | null;
  verifiedAt: Date;
  branch: Types.ObjectId;
  method: PaymentMethod;
  amount: number;
  verifiedBy?: string | null;
  refunded: number;
  o: { reference: string; contact: { fullName: string } } | null;
  u: { fullName: string } | null;
}

const VERIFIED_BY: Record<string, string> = { webhook: 'Paystack (webhook)', verify_api: 'Paystack (verified)' };

/** Verified payments and refunds. Needs financial report access for every branch in scope. */
export async function paymentsReport(auth: AuthContext, q: PaymentsQuery, out: Out): Promise<ReportPage<PaymentReportRow, PaymentReportSummary> | undefined> {
  const scope = await resolveScope(auth, q.branch);
  if (!scope.financial) throw forbidden('Payment reports need financial report access for every branch shown.');
  const range = resolveRange(q);
  const between = { $gte: range.start, $lt: range.end };
  const filter = { ...scopeMatch(scope), ...(q.method ? { method: q.method } : {}) };
  const match = { ...filter, status: 'success', verifiedAt: between };
  const branches = await branchRefs(scope);
  const enrich: PipelineStage.FacetPipelineStage[] = [
    { $lookup: { from: 'orders', localField: 'order', foreignField: '_id', as: 'o', pipeline: [{ $project: { reference: 1, 'contact.fullName': 1 } }] } },
    { $lookup: { from: 'users', localField: 'verifiedByUser', foreignField: '_id', as: 'u', pipeline: [{ $project: { fullName: 1 } }] } },
    {
      $project: {
        reference: 1, receiptNumber: 1, verifiedAt: 1, branch: 1, method: 1, amount: 1, verifiedBy: 1,
        o: { $first: '$o' },
        u: { $first: '$u' },
        refunded: { $sum: { $map: { input: { $filter: { input: '$refunds', cond: { $eq: ['$$this.status', 'processed'] } } }, in: '$$this.amount' } } },
      },
    },
  ];
  const toRow = (d: PaymentAgg): PaymentReportRow => ({
    id: d._id.toString(),
    reference: d.reference,
    receiptNumber: d.receiptNumber ?? null,
    verifiedAt: d.verifiedAt.toISOString(),
    branch: branches.get(d.branch.toString()) ?? unknownBranch(d.branch),
    orderReference: d.o?.reference ?? '',
    customerName: d.o?.contact.fullName ?? '',
    method: d.method,
    amount: d.amount,
    refunded: d.refunded,
    verifiedBy: d.u?.fullName ?? (d.verifiedBy ? (VERIFIED_BY[d.verifiedBy] ?? d.verifiedBy) : null),
  });

  if (q.format === 'csv') {
    const docs = Payment.aggregate<PaymentAgg>([{ $match: match }, { $sort: { verifiedAt: 1 } }, { $limit: CSV_MAX_ROWS }, ...enrich]).cursor();
    const count = await sendCsv(
      out.res,
      fileName('payments', scope, range),
      ['Payment', 'Receipt', 'Verified (Lagos)', 'Branch', 'Order', 'Customer', 'Method', 'Amount (NGN)', 'Refunded (NGN)', 'Verified by'],
      (async function* () {
        for await (const d of docs) {
          const r = toRow(d);
          yield [r.reference, r.receiptNumber, lagosDateTime(r.verifiedAt), r.branch.code, r.orderReference, r.customerName, r.method, naira(r.amount), naira(r.refunded), r.verifiedBy] satisfies CsvCell[];
        }
      })(),
    );
    await exported(auth, scope, 'payments', range, count, out.meta);
    return undefined;
  }

  const [[res], refunds] = await Promise.all([
    Payment.aggregate<{ rows: PaymentAgg[]; summary: { payments: number; received: number }[]; methods: { _id: PaymentMethod; payments: number; amount: number }[] }>([
      { $match: match },
      {
        $facet: {
          rows: [...facetPage({ verifiedAt: -1, _id: -1 }, q.page, q.limit), ...enrich],
          summary: [{ $group: { _id: null, payments: { $sum: 1 }, received: { $sum: '$amount' } } }],
          methods: [{ $group: { _id: '$method', payments: { $sum: 1 }, amount: { $sum: '$amount' } } }, { $sort: { amount: -1 } }],
        },
      },
    ]),
    Payment.aggregate<{ total: number }>([
      { $match: { ...filter, refunds: { $elemMatch: { status: 'processed', at: between } } } },
      { $unwind: '$refunds' },
      { $match: { 'refunds.status': 'processed', 'refunds.at': between } },
      { $group: { _id: null, total: { $sum: '$refunds.amount' } } },
    ]),
  ]);
  const s = res?.summary[0];
  const refunded = refunds[0]?.total ?? 0;
  const summary: PaymentReportSummary = {
    payments: s?.payments ?? 0,
    received: s?.received ?? 0,
    refunds: refunded,
    collectedRevenue: (s?.received ?? 0) - refunded,
    byMethod: (res?.methods ?? []).map((m) => ({ method: m._id, payments: m.payments, amount: m.amount })),
  };
  return pageOf(range, summary, (res?.rows ?? []).map(toRow), summary.payments, q.page, q.limit);
}

