import {
  type CustomerDto,
  type CustomerLookupDto,
  type InteractionDto,
  PERMISSIONS,
  type Permission,
  type SegmentDto,
  type SegmentFilter,
  normalizePhone,
  type createCustomerSchema,
  type interactionSchema,
  type listCustomersQuery,
  type segmentSchema,
  type updateCustomerSchema,
  type updateSegmentSchema,
} from '@mb/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import type { AuthContext } from '../../core/auth/AuthContext';
import { withTransaction } from '../../core/db/transaction';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors/AppError';
import { Page, escapeRegex, skipFor } from '../../core/http/pagination';
import type { RequestMeta } from '../../core/http/route';
import { audit, pick } from '../audit/audit.service';
import { Branch } from '../branches/branch.model';
import { requireBranches } from '../branches/branch.service';
import { User } from '../users/user.model';
import { CustomerInteraction, CustomerSegment, type ICustomerInteraction } from './crm.models';
import { Customer, type CustomerDoc, type ICustomer } from './customer.model';

const P = PERMISSIONS;

/**
 * Staff see a customer when one of their branches has served the customer, or is the
 * customer's preferred branch. The super admin sees everyone.
 */
export function customerScope(auth: AuthContext, permission: Permission = P.CUSTOMERS_READ): Record<string, unknown> {
  const scope = auth.branchesFor(permission);
  if (scope === 'ALL') return {};
  const ids = scope.map((s) => new Types.ObjectId(s));
  return { $or: [{ branchesServed: { $in: ids } }, { preferredBranch: { $in: ids } }] };
}

function isVisible(auth: AuthContext, c: Pick<ICustomer, 'branchesServed' | 'preferredBranch'>, permission: Permission = P.CUSTOMERS_READ): boolean {
  const scope = auth.branchesFor(permission);
  if (scope === 'ALL') return true;
  return c.branchesServed.some((b) => scope.includes(b.toString())) || (c.preferredBranch ? scope.includes(c.preferredBranch.toString()) : false);
}

const branchRef = (b: unknown) => {
  const x = b as { _id: Types.ObjectId; name: string; code: string } | null;
  return x && 'code' in x ? { id: x._id.toString(), name: x.name, code: x.code } : null;
};

type PopulatedCustomer = Omit<ICustomer, 'preferredBranch' | 'branchesServed' | 'registeredBy'> & {
  _id: Types.ObjectId;
  preferredBranch: unknown;
  branchesServed: unknown[];
  registeredBy: unknown;
};

function customerDto(c: PopulatedCustomer): CustomerDto {
  const reg = c.registeredBy as { _id: Types.ObjectId; fullName: string } | null;
  return {
    id: c._id.toString(),
    fullName: c.fullName,
    phone: c.phone,
    email: c.email ?? null,
    hasAccount: Boolean(c.user),
    preferredBranch: branchRef(c.preferredBranch),
    branchesServed: c.branchesServed.map(branchRef).filter((b): b is NonNullable<typeof b> => Boolean(b)),
    source: c.source,
    tags: c.tags,
    notes: c.notes ?? null,
    addresses: (c.addresses ?? []).map((a) => ({
      id: a._id.toString(),
      label: a.label ?? null,
      line1: a.line1,
      area: a.area ?? null,
      city: a.city,
      state: a.state,
      landmark: a.landmark ?? null,
      isDefault: a.isDefault,
    })),
    stats: {
      orderCount: c.stats?.orderCount ?? 0,
      totalSpent: c.stats?.totalSpent ?? 0,
      lastOrderAt: c.stats?.lastOrderAt ? new Date(c.stats.lastOrderAt).toISOString() : null,
      reservationCount: c.stats?.reservationCount ?? 0,
    },
    registeredBy: reg && 'fullName' in reg ? { id: reg._id.toString(), fullName: reg.fullName } : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

const POP = [
  { path: 'preferredBranch', select: 'name code' },
  { path: 'branchesServed', select: 'name code' },
  { path: 'registeredBy', select: 'fullName' },
];

async function loadDto(id: Types.ObjectId | string): Promise<CustomerDto> {
  const c = await Customer.findById(id).populate(POP).lean<PopulatedCustomer>();
  if (!c) throw notFound('Customer');
  return customerDto(c);
}

/** Converts a saved segment definition into a MongoDB filter. */
export function segmentQuery(f: SegmentFilter, now = new Date()): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  const range = (min?: number, max?: number) => ({ ...(min !== undefined ? { $gte: min } : {}), ...(max !== undefined ? { $lte: max } : {}) });
  if (f.minTotalSpent !== undefined || f.maxTotalSpent !== undefined) q['stats.totalSpent'] = range(f.minTotalSpent, f.maxTotalSpent);
  if (f.minOrders !== undefined || f.maxOrders !== undefined) q['stats.orderCount'] = range(f.minOrders, f.maxOrders);
  if (f.inactiveDays) {
    const cutoff = new Date(now.getTime() - f.inactiveDays * 86_400_000);
    q.$and = [...((q.$and as unknown[]) ?? []), { $or: [{ 'stats.lastOrderAt': { $lt: cutoff } }, { 'stats.lastOrderAt': null }] }];
  }
  if (f.joinedWithinDays) q.createdAt = { $gte: new Date(now.getTime() - f.joinedWithinDays * 86_400_000) };
  if (f.preferredBranch) q.preferredBranch = new Types.ObjectId(f.preferredBranch);
  if (f.branchServed) q.branchesServed = new Types.ObjectId(f.branchServed);
  if (f.tags?.length) q.tags = { $all: f.tags };
  if (f.source) q.source = f.source;
  return q;
}

function combine(...filters: Record<string, unknown>[]): Record<string, unknown> {
  const parts = filters.filter((f) => Object.keys(f).length > 0);
  return parts.length === 0 ? {} : parts.length === 1 ? parts[0]! : { $and: parts };
}

// ------------------------------------------------------------------ customers

export async function listCustomers(auth: AuthContext, q: z.output<typeof listCustomersQuery>): Promise<Page<CustomerDto>> {
  const parts: Record<string, unknown>[] = [customerScope(auth)];
  if (q.branch) {
    if (!auth.canAccessBranch(P.CUSTOMERS_READ, q.branch)) return Page.of([], 0, q.page, q.limit);
    parts.push({ branchesServed: new Types.ObjectId(q.branch) });
  }
  if (q.tag) parts.push({ tags: q.tag });
  if (q.source) parts.push({ source: q.source });
  if (q.segment) {
    const seg = await CustomerSegment.findById(q.segment).lean();
    if (!seg) throw notFound('Segment');
    parts.push(segmentQuery(seg.filter));
  }
  if (q.q) {
    const phone = normalizePhone(q.q);
    const rx = new RegExp(escapeRegex(q.q), 'i');
    parts.push({ $or: [{ fullName: rx }, { email: rx }, { phone: phone ?? rx }, ...(phone ? [] : [{ phone: new RegExp(escapeRegex(q.q.replace(/\D/g, '').replace(/^0/, ''))) }])] });
  }
  const filter = combine(...parts);
  const sort: Record<string, 1 | -1> = q.sort === 'name' ? { fullName: 1 } : q.sort === 'top_spenders' ? { 'stats.totalSpent': -1, _id: 1 } : { createdAt: -1, _id: -1 };
  const [rows, total] = await Promise.all([
    Customer.find(filter).sort(sort).skip(skipFor(q.page, q.limit)).limit(q.limit).populate(POP).lean<PopulatedCustomer[]>(),
    Customer.countDocuments(filter),
  ]);
  return Page.of(rows.map(customerDto), total, q.page, q.limit);
}

/**
 * Finds the central customer record for a phone number, even if another branch registered it,
 * so staff can serve existing customers instead of creating duplicates. Reveals only the name.
 */
export async function lookupCustomer(auth: AuthContext, phone: string): Promise<CustomerLookupDto | null> {
  const c = await Customer.findOne({ phone }).select('fullName phone branchesServed preferredBranch').lean();
  if (!c) return null;
  return { id: c._id.toString(), fullName: c.fullName, phone: c.phone, inScope: isVisible(auth, c) };
}

export async function getCustomer(auth: AuthContext, id: string): Promise<CustomerDto> {
  const c = await Customer.findById(id).select('branchesServed preferredBranch').lean();
  if (!c || !isVisible(auth, c)) throw notFound('Customer');
  return loadDto(id);
}

async function logInteraction(data: { customer: Types.ObjectId; branch?: Types.ObjectId | string | null; channel: ICustomerInteraction['channel']; direction: 'inbound' | 'outbound'; summary: string; relatedTo?: { kind: string; id: Types.ObjectId; label?: string }; recordedBy?: string | null }) {
  await CustomerInteraction.create([
    {
      ...data,
      branch: data.branch ? new Types.ObjectId(String(data.branch)) : null,
      recordedBy: data.recordedBy ? new Types.ObjectId(data.recordedBy) : null,
    },
  ]);
}

export async function createCustomer(auth: AuthContext, input: z.output<typeof createCustomerSchema>, meta: RequestMeta): Promise<CustomerDto> {
  if (!auth.canAccessBranch(P.CUSTOMERS_CREATE, input.branch)) throw forbidden('You can only register customers at your own branches.');
  const [branch] = await requireBranches([input.branch], { activeOnly: true });
  if (input.preferredBranch) await requireBranches([input.preferredBranch], { activeOnly: true });

  const id = await withTransaction(async () => {
    const existing = await Customer.findOne({ phone: input.phone }).select('fullName branchesServed preferredBranch').lean();
    if (existing) {
      throw conflict(`${existing.fullName} is already registered with this phone number.`, { customerId: existing._id.toString(), inScope: isVisible(auth, existing), phone: ['Already registered'] }, 'CUSTOMER_EXISTS');
    }
    if (input.email && (await Customer.exists({ email: input.email }))) {
      throw conflict('Another customer already uses this email address.', { email: ['Already in use'] }, 'DUPLICATE');
    }
    const [c] = await Customer.create([
      {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        source: input.source,
        branchesServed: [branch!._id],
        preferredBranch: input.preferredBranch ?? branch!._id,
        registeredBy: auth.userId,
        registeredAtBranch: branch!._id,
        tags: [...new Set(input.tags)],
        notes: input.notes,
        addresses: input.address ? [{ ...input.address, isDefault: true }] : [],
      },
    ]);
    await logInteraction({ customer: c!._id, branch: branch!._id, channel: 'system', direction: 'inbound', summary: `Registered at ${branch!.name} (${input.source.replace('_', ' ')})`, recordedBy: auth.userId });
    await audit({ action: 'customer.created', actor: auth, branch: branch!._id, entity: { kind: 'Customer', id: c!._id, label: c!.fullName } }, meta);
    return c!._id;
  });
  return loadDto(id);
}

export async function updateCustomer(auth: AuthContext, id: string, input: z.output<typeof updateCustomerSchema>, meta: RequestMeta): Promise<CustomerDto> {
  await withTransaction(async () => {
    const c = await Customer.findById(id);
    if (!c || !isVisible(auth, c)) throw notFound('Customer');
    if (!isVisible(auth, c, P.CUSTOMERS_UPDATE)) throw forbidden();
    const before = pick(c, ['fullName', 'email', 'preferredBranch', 'tags', 'notes']);

    if (input.email !== undefined && input.email !== (c.email ?? null)) {
      if (input.email && (await Customer.exists({ email: input.email, _id: { $ne: c._id } }))) {
        throw conflict('Another customer already uses this email address.', { email: ['Already in use'] }, 'DUPLICATE');
      }
      if (input.email && c.user && (await User.exists({ email: input.email, _id: { $ne: c.user } }))) {
        throw conflict('Another account already uses this email address.', { email: ['Already in use'] }, 'DUPLICATE');
      }
      c.email = input.email ?? undefined;
    }
    if (input.preferredBranch !== undefined) {
      if (input.preferredBranch) await requireBranches([input.preferredBranch]);
      c.preferredBranch = input.preferredBranch ? new Types.ObjectId(input.preferredBranch) : undefined;
    }
    if (input.fullName !== undefined) c.fullName = input.fullName;
    if (input.tags !== undefined) c.tags = [...new Set(input.tags)];
    if (input.notes !== undefined) c.notes = input.notes;
    if (input.addresses !== undefined) {
      const addrs = input.addresses.map((a, i) => ({ ...a, isDefault: input.addresses!.some((x) => x.isDefault) ? a.isDefault : i === 0 }));
      c.set('addresses', addrs);
    }
    await c.save();
    // The customer's online account mirrors name and email.
    if (c.user) await User.updateOne({ _id: c.user }, { $set: { fullName: c.fullName, ...(c.email ? { email: c.email } : {}) } });
    await audit({ action: 'customer.updated', actor: auth, branch: c.branchesServed[0] ?? null, entity: { kind: 'Customer', id: c._id, label: c.fullName }, before, after: pick(c, ['fullName', 'email', 'preferredBranch', 'tags', 'notes']) }, meta);
  });
  return loadDto(id);
}

/** Start serving an existing customer (found by phone lookup) at another branch. */
export async function linkCustomerToBranch(auth: AuthContext, id: string, branchId: string, meta: RequestMeta): Promise<CustomerDto> {
  if (!auth.canAccessBranch(P.CUSTOMERS_CREATE, branchId)) throw forbidden('You can only add customers to your own branches.');
  const [branch] = await requireBranches([branchId], { activeOnly: true });
  await withTransaction(async () => {
    const res = await Customer.updateOne({ _id: id }, { $addToSet: { branchesServed: branch!._id } });
    if (res.matchedCount === 0) throw notFound('Customer');
    if (res.modifiedCount) {
      await logInteraction({ customer: new Types.ObjectId(id), branch: branch!._id, channel: 'system', direction: 'inbound', summary: `Now also served at ${branch!.name}`, recordedBy: auth.userId });
      await audit({ action: 'customer.branch_linked', actor: auth, branch: branch!._id, entity: { kind: 'Customer', id: new Types.ObjectId(id) } }, meta);
    }
  });
  return loadDto(id);
}

/** Marks a customer as served by a branch (used by enquiries now, and orders and reservations later). */
export async function markServed(customerId: Types.ObjectId, branchId: Types.ObjectId): Promise<void> {
  await Customer.updateOne({ _id: customerId }, { $addToSet: { branchesServed: branchId } });
}

// ------------------------------------------------------------------ interactions

export async function listInteractions(auth: AuthContext, id: string): Promise<InteractionDto[]> {
  const c = await Customer.findById(id).select('branchesServed preferredBranch').lean();
  if (!c || !isVisible(auth, c)) throw notFound('Customer');
  const rows = await CustomerInteraction.find({ customer: c._id }).sort({ createdAt: -1 }).limit(200).populate('branch', 'name code').populate('recordedBy', 'fullName').lean();
  return rows.map((r) => {
    const by = r.recordedBy as unknown as { _id: Types.ObjectId; fullName: string } | null;
    return {
      id: r._id.toString(),
      branch: branchRef(r.branch),
      channel: r.channel,
      direction: r.direction,
      summary: r.summary,
      relatedTo: r.relatedTo?.kind ? { kind: r.relatedTo.kind, id: r.relatedTo.id.toString(), label: r.relatedTo.label ?? null } : null,
      recordedBy: by ? { id: by._id.toString(), fullName: by.fullName } : null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function addInteraction(auth: AuthContext, id: string, input: z.output<typeof interactionSchema>): Promise<InteractionDto[]> {
  if (!auth.canAccessBranch(P.CUSTOMERS_CREATE, input.branch)) throw forbidden('Record communication for your own branches only.');
  const c = await Customer.findById(id).select('branchesServed preferredBranch').lean();
  if (!c || !isVisible(auth, c)) throw notFound('Customer');
  await withTransaction(async () => {
    await logInteraction({ customer: c._id, branch: input.branch, channel: input.channel, direction: input.direction, summary: input.summary, recordedBy: auth.userId });
    await markServed(c._id, new Types.ObjectId(input.branch));
  });
  return listInteractions(auth, id);
}

// ------------------------------------------------------------------ segments

async function segmentDto(auth: AuthContext, s: { _id: Types.ObjectId; name: string; description?: string; filter: SegmentFilter; createdBy: unknown; updatedAt: Date }): Promise<SegmentDto> {
  const by = s.createdBy as { _id: Types.ObjectId; fullName: string } | null;
  return {
    id: s._id.toString(),
    name: s.name,
    description: s.description ?? null,
    filter: s.filter,
    customerCount: await Customer.countDocuments(combine(customerScope(auth), segmentQuery(s.filter))),
    createdBy: by && 'fullName' in by ? { id: by._id.toString(), fullName: by.fullName } : null,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function listSegments(auth: AuthContext): Promise<SegmentDto[]> {
  const rows = await CustomerSegment.find().sort({ name: 1 }).populate('createdBy', 'fullName').lean();
  return Promise.all(rows.map((r) => segmentDto(auth, r)));
}

export async function previewSegment(auth: AuthContext, filter: SegmentFilter): Promise<{ count: number }> {
  return { count: await Customer.countDocuments(combine(customerScope(auth), segmentQuery(filter))) };
}

async function assertFilterBranches(auth: AuthContext, f: SegmentFilter) {
  for (const b of [f.preferredBranch, f.branchServed]) {
    if (b && !(await Branch.exists({ _id: b }))) throw badRequest('A branch in the conditions does not exist.');
    if (b && !auth.canAccessBranch(P.CUSTOMERS_READ, b)) throw forbidden('Segments can only refer to your own branches.');
  }
}

export async function createSegment(auth: AuthContext, input: z.output<typeof segmentSchema>, meta: RequestMeta): Promise<SegmentDto> {
  await assertFilterBranches(auth, input.filter);
  const seg = await CustomerSegment.create({ ...input, createdBy: auth.userId });
  await audit({ action: 'segment.created', actor: auth, entity: { kind: 'CustomerSegment', id: seg._id, label: seg.name }, after: input }, meta);
  const full = await CustomerSegment.findById(seg._id).populate('createdBy', 'fullName').lean();
  return segmentDto(auth, full!);
}

export async function updateSegment(auth: AuthContext, id: string, input: z.output<typeof updateSegmentSchema>, meta: RequestMeta): Promise<SegmentDto> {
  const seg = await CustomerSegment.findById(id);
  if (!seg) throw notFound('Segment');
  if (input.filter) await assertFilterBranches(auth, input.filter);
  const before = pick(seg, ['name', 'description', 'filter']);
  seg.set(input);
  await seg.save();
  await audit({ action: 'segment.updated', actor: auth, entity: { kind: 'CustomerSegment', id: seg._id, label: seg.name }, before, after: pick(seg, ['name', 'description', 'filter']) }, meta);
  const full = await CustomerSegment.findById(seg._id).populate('createdBy', 'fullName').lean();
  return segmentDto(auth, full!);
}

export async function deleteSegment(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
  const seg = await CustomerSegment.findByIdAndDelete(id);
  if (!seg) throw notFound('Segment');
  await audit({ action: 'segment.deleted', actor: auth, entity: { kind: 'CustomerSegment', id: seg._id, label: seg.name } }, meta);
}

export type { CustomerDoc };
