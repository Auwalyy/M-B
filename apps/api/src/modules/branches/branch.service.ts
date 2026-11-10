import {
  BRANCH_PROFILE_FIELDS,
  type BranchDto,
  type BranchStatus,
  PERMISSIONS,
  type PublicBranchDto,
  type createBranchSchema,
  type listBranchesQuery,
  type updateBranchSchema,
} from '@mb/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import type { AuthContext } from '../../core/auth/AuthContext';
import { withTransaction } from '../../core/db/transaction';
import { badRequest, forbidden, notFound } from '../../core/errors/AppError';
import { Page, escapeRegex, skipFor } from '../../core/http/pagination';
import type { RequestMeta } from '../../core/http/route';
import { audit, pick } from '../audit/audit.service';
import { User } from '../users/user.model';
import { Branch, type BranchDoc, type IBranch } from './branch.model';

type LeanBranch = IBranch & { _id: Types.ObjectId };
type PopulatedAdmins = { admins: { _id: Types.ObjectId; fullName: string }[] };
/** A branch document or lean object, with admins either as ids or populated. */
type BranchLike = Omit<LeanBranch, 'admins'> & { admins?: unknown[] };

const AUDIT_FIELDS = [
  'name', 'code', 'address', 'area', 'landmark', 'city', 'state', 'phone', 'whatsapp', 'email',
  'location', 'openingHours', 'settings', 'status',
] as const;

export function toPublicBranch(b: BranchLike): PublicBranchDto {
  const coords = b.location?.coordinates;
  return {
    id: b._id.toString(),
    name: b.name,
    code: b.code,
    address: b.address,
    area: b.area ?? null,
    landmark: b.landmark ?? null,
    city: b.city,
    state: b.state,
    phone: b.phone,
    whatsapp: b.whatsapp,
    email: b.email ?? null,
    coordinates: coords && coords.length === 2 ? { lng: coords[0]!, lat: coords[1]! } : null,
    openingHours: (b.openingHours ?? []).map((h) => ({ day: h.day, open: h.open, close: h.close, closed: h.closed })),
    services: {
      reservations: b.settings?.reservationsEnabled ?? true,
      pickup: b.settings?.pickupEnabled ?? true,
      delivery: b.settings?.deliveryEnabled ?? true,
    },
  };
}

export function toBranchDto(b: BranchLike, staffCount?: number): BranchDto {
  const admins = (b.admins ?? []) as unknown[];
  return {
    ...toPublicBranch(b),
    status: b.status,
    admins: admins
      .filter((a): a is { _id: Types.ObjectId; fullName: string } => typeof a === 'object' && a !== null && 'fullName' in a)
      .map((a) => ({ id: a._id.toString(), fullName: a.fullName })),
    settings: {
      reservationsEnabled: b.settings?.reservationsEnabled ?? true,
      pickupEnabled: b.settings?.pickupEnabled ?? true,
      deliveryEnabled: b.settings?.deliveryEnabled ?? true,
      reservationHoldHours: b.settings?.reservationHoldHours ?? null,
    },
    staffCount,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

async function staffCounts(branchIds: Types.ObjectId[]): Promise<Map<string, number>> {
  const rows = await User.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { branches: { $in: branchIds }, status: 'active', roleKey: { $in: ['BRANCH_ADMIN', 'SALES_STAFF'] } } },
    { $unwind: '$branches' },
    { $match: { branches: { $in: branchIds } } },
    { $group: { _id: '$branches', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.n]));
}

function idOrCodeFilter(idOrCode: string) {
  return Types.ObjectId.isValid(idOrCode) && /^[a-f\d]{24}$/i.test(idOrCode)
    ? { _id: new Types.ObjectId(idOrCode) }
    : { code: idOrCode.toUpperCase() };
}

type ListQuery = z.output<typeof listBranchesQuery>;

/** Visitors see active branches with public fields. Staff see the branches in their scope, with full details. */
export async function listBranches(q: ListQuery, auth: AuthContext | null): Promise<Page<PublicBranchDto | BranchDto>> {
  const staff = auth?.can(PERMISSIONS.BRANCHES_READ) ? auth : null;
  const filter: Record<string, unknown> = staff
    ? { ...staff.branchFilter(PERMISSIONS.BRANCHES_READ, '_id'), ...(q.status ? { status: q.status } : {}) }
    : { status: 'active' };
  if (q.state) filter.state = q.state;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ name: rx }, { code: rx }, { city: rx }, { area: rx }];
  }
  const [items, total] = await Promise.all([
    Branch.find(filter)
      .sort({ state: 1, name: 1 })
      .skip(skipFor(q.page, q.limit))
      .limit(q.limit)
      .populate(staff ? { path: 'admins', select: 'fullName' } : [])
      .lean<(LeanBranch & PopulatedAdmins)[]>(),
    Branch.countDocuments(filter),
  ]);
  if (!staff) return Page.of(items.map(toPublicBranch), total, q.page, q.limit);
  const counts = await staffCounts(items.map((b) => b._id));
  return Page.of(items.map((b) => toBranchDto(b, counts.get(b._id.toString()) ?? 0)), total, q.page, q.limit);
}

export async function getBranch(idOrCode: string, auth: AuthContext | null): Promise<PublicBranchDto | BranchDto> {
  const branch = await Branch.findOne(idOrCodeFilter(idOrCode))
    .populate({ path: 'admins', select: 'fullName' })
    .lean<LeanBranch & PopulatedAdmins>();
  if (!branch) throw notFound('Branch');
  if (auth?.canAccessBranch(PERMISSIONS.BRANCHES_READ, branch._id)) {
    const counts = await staffCounts([branch._id]);
    return toBranchDto(branch, counts.get(branch._id.toString()) ?? 0);
  }
  if (branch.status !== 'active') throw notFound('Branch');
  return toPublicBranch(branch);
}

type CreateInput = z.output<typeof createBranchSchema>;
type UpdateInput = z.output<typeof updateBranchSchema>;

function applyInput(branch: BranchDoc, input: UpdateInput) {
  const { coordinates, settings, ...rest } = input;
  branch.set(rest);
  if (coordinates) branch.set('location', { type: 'Point', coordinates: [coordinates.lng, coordinates.lat] });
  if (settings) {
    for (const [k, v] of Object.entries(settings)) {
      if (v !== undefined) branch.set(`settings.${k}`, v);
    }
  }
}

export async function createBranch(input: CreateInput, auth: AuthContext, meta: RequestMeta): Promise<BranchDto> {
  return withTransaction(async () => {
    const branch = new Branch({ createdBy: auth.userId });
    applyInput(branch, input);
    await branch.save();
    await audit(
      {
        action: 'branch.created',
        actor: auth,
        branch: branch._id,
        entity: { kind: 'Branch', id: branch._id, label: `${branch.code} – ${branch.name}` },
        after: pick(branch, AUDIT_FIELDS),
      },
      meta,
    );
    return toBranchDto(branch, 0);
  });
}

export async function updateBranch(id: string, input: UpdateInput, auth: AuthContext, meta: RequestMeta): Promise<BranchDto> {
  return withTransaction(async () => {
    const branch = await Branch.findById(id);
    if (!branch || !auth.canAccessBranch(PERMISSIONS.BRANCHES_READ, branch._id)) throw notFound('Branch');

    const fullEdit = auth.canAccessBranch(PERMISSIONS.BRANCHES_UPDATE, branch._id);
    if (!fullEdit) {
      if (!auth.canAccessBranch(PERMISSIONS.BRANCHES_UPDATE_PROFILE, branch._id)) throw forbidden();
      const notAllowed = Object.keys(input).filter(
        (k) => input[k as keyof UpdateInput] !== undefined && !(BRANCH_PROFILE_FIELDS as readonly string[]).includes(k),
      );
      if (notAllowed.length) {
        throw forbidden(`Only the Super Admin can change: ${notAllowed.join(', ')}`, 'FIELD_NOT_EDITABLE');
      }
    }

    const before = pick(branch, AUDIT_FIELDS);
    applyInput(branch, input);
    if (!branch.isModified()) return getFull(branch._id);
    await branch.save();
    await audit(
      {
        action: 'branch.updated',
        actor: auth,
        branch: branch._id,
        entity: { kind: 'Branch', id: branch._id, label: `${branch.code} – ${branch.name}` },
        before,
        after: pick(branch, AUDIT_FIELDS),
      },
      meta,
    );
    return getFull(branch._id);
  });
}

async function getFull(id: Types.ObjectId): Promise<BranchDto> {
  const b = await Branch.findById(id).populate({ path: 'admins', select: 'fullName' }).lean<LeanBranch & PopulatedAdmins>();
  const counts = await staffCounts([id]);
  return toBranchDto(b!, counts.get(id.toString()) ?? 0);
}

export async function setBranchStatus(id: string, status: BranchStatus, auth: AuthContext, meta: RequestMeta): Promise<BranchDto> {
  return withTransaction(async () => {
    const branch = await Branch.findById(id);
    if (!branch || !auth.canAccessBranch(PERMISSIONS.BRANCHES_DEACTIVATE, branch._id)) throw notFound('Branch');
    if (branch.status === status) throw badRequest(`Branch is already ${status}.`);
    branch.status = status;
    await branch.save();
    await audit(
      {
        action: status === 'active' ? 'branch.activated' : 'branch.deactivated',
        actor: auth,
        branch: branch._id,
        entity: { kind: 'Branch', id: branch._id, label: `${branch.code} – ${branch.name}` },
        before: { status: status === 'active' ? 'inactive' : 'active' },
        after: { status },
      },
      meta,
    );
    return getFull(branch._id);
  });
}

/** Throws unless every id refers to an existing branch. Returns the branches. */
export async function requireBranches(ids: string[], opts: { activeOnly?: boolean } = {}) {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const found = await Branch.find({ _id: { $in: unique }, ...(opts.activeOnly ? { status: 'active' } : {}) })
    .select('name code status')
    .lean();
  if (found.length !== unique.length) {
    throw badRequest(opts.activeOnly ? 'One or more branches do not exist or are inactive.' : 'One or more branches do not exist.');
  }
  return found;
}
