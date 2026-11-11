import type { OrderStatus } from '@mb/shared';
import type { PipelineStage, Types } from 'mongoose';
import { Order } from '../commerce/commerce.models';
import { Inventory } from '../inventory/inventory.models';
import { getSettingsDoc } from '../settings/settings.service';
import { Payment } from '../transactions/transactions.models';
import { type ReportScope, type ResolvedRange, scopeMatch } from './scope';

/**
 * The revenue metrics of docs/FOUNDATION.md §1.5, each grouped by branch.
 * Overviews add the branches up; the branch comparison uses them as they are.
 */

/** Orders the branch has accepted. Pending, cancelled and refunded orders are not sales. */
export const SOLD_STATUSES: OrderStatus[] = ['confirmed', 'processing', 'ready_for_pickup', 'out_for_delivery', 'completed'];

export type ByBranch<T> = Map<string, T>;

const between = (r: Pick<ResolvedRange, 'start' | 'end'>) => ({ $gte: r.start, $lt: r.end });

/** Gross sales: accepted orders dated by when they were confirmed. */
export function salesMatch(scope: ReportScope, r: Pick<ResolvedRange, 'start' | 'end'>): Record<string, unknown> {
  return { ...scopeMatch(scope), status: { $in: SOLD_STATUSES }, confirmedAt: between(r) };
}

async function grouped<T>(model: { aggregate: (p: PipelineStage[]) => { exec(): Promise<unknown[]> } }, pipeline: PipelineStage[]): Promise<ByBranch<T>> {
  const rows = (await model.aggregate(pipeline).exec()) as ({ _id: Types.ObjectId } & T)[];
  return new Map(rows.map(({ _id, ...rest }) => [_id.toString(), rest as T]));
}

export function sumOf<T>(m: ByBranch<T>, key: keyof T): number {
  let n = 0;
  for (const v of m.values()) n += Number(v[key] ?? 0);
  return n;
}

export function salesByBranch(scope: ReportScope, r: Pick<ResolvedRange, 'start' | 'end'>) {
  return grouped<{ grossSales: number; orders: number }>(Order, [
    { $match: salesMatch(scope, r) },
    { $group: { _id: '$branch', grossSales: { $sum: '$total' }, orders: { $sum: 1 } } },
  ]);
}

/** Units sold: items on completed orders, dated by completion. */
export function unitsByBranch(scope: ReportScope, r: Pick<ResolvedRange, 'start' | 'end'>) {
  return grouped<{ units: number }>(Order, [
    { $match: { ...scopeMatch(scope), status: 'completed', completedAt: between(r) } },
    { $unwind: '$items' },
    { $group: { _id: '$branch', units: { $sum: '$items.quantity' } } },
  ]);
}

/** Verified payments, dated by verification. */
export function receivedByBranch(scope: ReportScope, r: Pick<ResolvedRange, 'start' | 'end'>) {
  return grouped<{ received: number; payments: number }>(Payment, [
    { $match: { ...scopeMatch(scope), status: 'success', verifiedAt: between(r) } },
    { $group: { _id: '$branch', received: { $sum: '$amount' }, payments: { $sum: 1 } } },
  ]);
}

/** Processed refunds, dated by when the refund was made. */
export function refundsByBranch(scope: ReportScope, r: Pick<ResolvedRange, 'start' | 'end'>) {
  const window = { status: 'processed', at: between(r) };
  return grouped<{ refunds: number }>(Payment, [
    { $match: { ...scopeMatch(scope), refunds: { $elemMatch: window } } },
    { $unwind: '$refunds' },
    { $match: { 'refunds.status': 'processed', 'refunds.at': between(r) } },
    { $group: { _id: '$branch', refunds: { $sum: '$refunds.amount' } } },
  ]);
}

/** Collected revenue = verified payments − processed refunds, per branch. */
export async function collectedByBranch(scope: ReportScope, r: Pick<ResolvedRange, 'start' | 'end'>) {
  const [received, refunds] = await Promise.all([receivedByBranch(scope, r), refundsByBranch(scope, r)]);
  const out: ByBranch<{ received: number; refunds: number; collected: number }> = new Map();
  for (const id of new Set([...received.keys(), ...refunds.keys()])) {
    const rec = received.get(id)?.received ?? 0;
    const ref = refunds.get(id)?.refunds ?? 0;
    out.set(id, { received: rec, refunds: ref, collected: rec - ref });
  }
  return out;
}

/** Accepted orders not yet handed over. */
export const OPEN_STATUSES: OrderStatus[] = SOLD_STATUSES.filter((s) => s !== 'completed');

/**
 * Outstanding balance on accepted orders, as of now. Completed orders are left out: completion
 * needs full payment, so a later partial refund there is a return, not money owed.
 */
export function outstandingByBranch(scope: ReportScope) {
  return grouped<{ outstanding: number; orders: number }>(Order, [
    { $match: { ...scopeMatch(scope), status: { $in: OPEN_STATUSES } } },
    { $project: { branch: 1, due: { $subtract: ['$total', '$amountPaid'] } } },
    { $match: { due: { $gt: 0 } } },
    { $group: { _id: '$branch', outstanding: { $sum: '$due' }, orders: { $sum: 1 } } },
  ]);
}

/** Stock on hand, value at cost and stock alerts, as of now. */
export async function inventoryByBranch(scope: ReportScope) {
  const { lowStockDefault } = await getSettingsDoc();
  return grouped<{ units: number; value: number; withoutCost: number; low: number; out: number }>(Inventory, [
    { $match: scopeMatch(scope) },
    { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'p', pipeline: [{ $project: { costPrice: 1 } }] } },
    {
      $project: {
        branch: 1,
        quantity: 1,
        cost: { $ifNull: [{ $first: '$p.costPrice' }, null] },
        available: { $subtract: ['$quantity', '$reserved'] },
        reorder: { $ifNull: ['$reorderLevel', lowStockDefault] },
      },
    },
    {
      $group: {
        _id: '$branch',
        units: { $sum: '$quantity' },
        value: { $sum: { $multiply: ['$quantity', { $ifNull: ['$cost', 0] }] } },
        withoutCost: { $sum: { $cond: [{ $and: [{ $eq: ['$cost', null] }, { $gt: ['$quantity', 0] }] }, 1, 0] } },
        low: { $sum: { $cond: [{ $and: [{ $gt: ['$available', 0] }, { $lte: ['$available', '$reorder'] }] }, 1, 0] } },
        out: { $sum: { $cond: [{ $lte: ['$available', 0] }, 1, 0] } },
      },
    },
  ]);
}
