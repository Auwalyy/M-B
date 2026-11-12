import mongoose, { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { Product } from '../src/modules/catalog/catalog.models';
import { Order } from '../src/modules/commerce/commerce.models';
import { Enquiry } from '../src/modules/customers/crm.models';
import { Customer } from '../src/modules/customers/customer.model';
import { InventoryMovement } from '../src/modules/inventory/inventory.models';
import { Delivery, Payment, Reservation } from '../src/modules/transactions/transactions.models';
import { makeApp } from './helpers';

/**
 * Guards the query plans of the busiest and heaviest queries: each must use an index, never
 * scan a whole collection. Runs `explain` on the real indexes the models declare, so dropping
 * or reordering an index that a dashboard or list depends on fails the build.
 */
makeApp(); // registers every model

type AnyModel = mongoose.Model<never>;

/** Every winning-plan stage name in an explain result (find, count or aggregate). */
function stages(explain: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown, inWinning: boolean) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, inWinning));
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'rejectedPlans') continue;
      if (k === 'stage' && inWinning && typeof v === 'string') out.push(v);
      walk(v, inWinning || k === 'winningPlan');
    }
  };
  walk(explain, false);
  return out;
}

const assertIndexed = (name: string, explain: unknown) => {
  const s = stages(explain);
  expect(s, `${name}: ${s.join(' > ')}`).toContain('IXSCAN');
  expect(s, `${name}: ${s.join(' > ')}`).not.toContain('COLLSCAN');
};

const branch = new Types.ObjectId();
const since = new Date(Date.now() - 30 * 86_400_000);
const now = new Date();
const scopes = { company: {}, branch: { branch: { $in: [branch] } } };

beforeAll(async () => {
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).syncIndexes()));
});

describe('query plans', () => {
  const finds: [string, AnyModel, Record<string, unknown>, Record<string, 1 | -1>?][] = [];
  for (const [scope, match] of Object.entries(scopes)) {
    finds.push(
      [`${scope}: orders list`, Order as unknown as AnyModel, match, { createdAt: -1 }],
      [`${scope}: orders waiting`, Order as unknown as AnyModel, { ...match, status: 'pending' }],
      [`${scope}: gross sales range`, Order as unknown as AnyModel, { ...match, status: { $in: ['confirmed', 'completed'] }, confirmedAt: { $gte: since, $lt: now } }],
      [`${scope}: units sold range`, Order as unknown as AnyModel, { ...match, status: 'completed', completedAt: { $gte: since, $lt: now } }],
      [`${scope}: collected revenue`, Payment as unknown as AnyModel, { ...match, status: 'success', verifiedAt: { $gte: since, $lt: now } }],
      [`${scope}: refunds by date`, Payment as unknown as AnyModel, { ...match, refunds: { $elemMatch: { status: 'processed', at: { $gte: since, $lt: now } } } }],
      [`${scope}: payments to check`, Payment as unknown as AnyModel, { ...match, status: 'pending', method: { $ne: 'paystack' } }],
      [`${scope}: open reservations`, Reservation as unknown as AnyModel, { ...match, status: { $in: ['pending', 'confirmed'] } }],
      [`${scope}: active deliveries`, Delivery as unknown as AnyModel, { ...match, status: { $in: ['assigned', 'in_transit'] } }],
      [`${scope}: open enquiries`, Enquiry as unknown as AnyModel, { ...match, status: { $in: ['new', 'in_progress'] } }],
      [`${scope}: stock history`, InventoryMovement as unknown as AnyModel, match, { createdAt: -1 }],
    );
  }
  finds.push(
    ['new customers (company)', Customer as unknown as AnyModel, { createdAt: { $gte: since, $lt: now } }],
    ['new customers (branch)', Customer as unknown as AnyModel, { branchesServed: { $in: [branch] }, createdAt: { $gte: since, $lt: now } }],
    ['shop listing', Product as unknown as AnyModel, { status: 'active', categoryPath: new Types.ObjectId() }, { effectivePrice: 1 }],
    ['featured products', Product as unknown as AnyModel, { status: 'active', isFeatured: true }, { createdAt: -1 }],
    ['reservation expiry job', Reservation as unknown as AnyModel, { status: 'pending', expiresAt: { $lte: now } }],
  );

  it.each(finds)('%s uses an index', async (name, model, filter, sort) => {
    const explain = await model.collection.find(filter).sort(sort ?? {}).limit(25).explain('queryPlanner');
    assertIndexed(name, explain);
  });

  it('report aggregations start from an index', async () => {
    for (const [scope, match] of Object.entries(scopes)) {
      const explain = await Order.collection
        .aggregate([{ $match: { ...match, status: { $in: ['confirmed', 'completed'] }, confirmedAt: { $gte: since, $lt: now } } }, { $group: { _id: '$branch', n: { $sum: '$total' } } }])
        .explain('queryPlanner');
      assertIndexed(`${scope}: sales aggregation`, explain);
    }
  });
});
