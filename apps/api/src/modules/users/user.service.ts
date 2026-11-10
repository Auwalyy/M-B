import {
  BRANCH_BOUND_ROLES,
  COMPANY_ONLY_PERMISSIONS,
  PERMISSIONS,
  type Permission,
  ROLE_RANK,
  type RoleKey,
  STAFF_ROLE_KEYS,
  type StaffDto,
  type UserStatus,
  type branchAccessGrantSchema,
  type createStaffSchema,
  type listUsersQuery,
  type updateStaffSchema,
} from '@mb/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { env } from '../../config/env';
import type { AuthContext } from '../../core/auth/AuthContext';
import { hashPassword } from '../../core/auth/password';
import { withTransaction } from '../../core/db/transaction';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors/AppError';
import { Page, escapeRegex, skipFor } from '../../core/http/pagination';
import type { RequestMeta } from '../../core/http/route';
import { queueEmail } from '../../core/mail/mailer';
import { staffWelcomeEmail } from '../../core/mail/templates';
import { audit, pick } from '../audit/audit.service';
import { revokeAllSessions } from '../auth/session.service';
import { Branch } from '../branches/branch.model';
import { requireBranches } from '../branches/branch.service';
import { Role } from '../roles/role.model';
import { getRoleByKey } from '../roles/role.service';
import { type IUser, User, type UserDoc } from './user.model';

const P = PERMISSIONS;
const AUDIT_FIELDS = ['fullName', 'email', 'phone', 'roleKey', 'branches', 'status', 'mustChangePassword'] as const;

interface BranchLite { _id: Types.ObjectId; name: string; code: string }
type PopulatedUser = Omit<IUser, 'branches' | 'branchAccessGrants'> & {
  _id: Types.ObjectId;
  branches: BranchLite[];
  branchAccessGrants: {
    _id: Types.ObjectId;
    branch: BranchLite | null;
    permissions: Permission[];
    expiresAt: Date;
    reason: string;
    grantedBy: { _id: Types.ObjectId; fullName: string } | null;
    createdAt: Date;
  }[];
};

const branchRef = (b: BranchLite) => ({ id: b._id.toString(), name: b.name, code: b.code });

export async function roleNames(): Promise<Map<RoleKey, string>> {
  const roles = await Role.find().select('key name').lean();
  return new Map(roles.map((r) => [r.key, r.name]));
}

export function toStaffDto(u: PopulatedUser, names: Map<RoleKey, string>): StaffDto {
  const now = Date.now();
  return {
    id: u._id.toString(),
    fullName: u.fullName,
    email: u.email ?? null,
    phone: u.phone ?? null,
    role: u.roleKey,
    roleName: names.get(u.roleKey) ?? u.roleKey,
    status: u.status,
    branches: (u.branches ?? []).filter(Boolean).map(branchRef),
    grants: (u.branchAccessGrants ?? [])
      .filter((g) => g.branch && new Date(g.expiresAt).getTime() > now)
      .map((g) => ({
        id: g._id.toString(),
        branch: branchRef(g.branch!),
        permissions: g.permissions,
        expiresAt: new Date(g.expiresAt).toISOString(),
        reason: g.reason,
        grantedBy: g.grantedBy ? { id: g.grantedBy._id.toString(), fullName: g.grantedBy.fullName } : null,
        createdAt: new Date(g.createdAt).toISOString(),
      })),
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
    createdAt: new Date(u.createdAt).toISOString(),
  };
}

async function loadStaffDto(id: Types.ObjectId | string): Promise<StaffDto> {
  const u = await User.findById(id)
    .populate({ path: 'branches', select: 'name code' })
    .populate({ path: 'branchAccessGrants.branch', select: 'name code' })
    .populate({ path: 'branchAccessGrants.grantedBy', select: 'fullName' })
    .lean<PopulatedUser>();
  if (!u) throw notFound('Staff member');
  return toStaffDto(u, await roleNames());
}

/**
 * Throws 404 when the target is not staff, or is outside the caller's branch scope
 * for the permission. The 404 keeps other branches' staff hidden.
 */
function assertVisible(auth: AuthContext, target: Pick<IUser, 'roleKey' | 'branches'>, permission: Permission) {
  if (!(STAFF_ROLE_KEYS as readonly string[]).includes(target.roleKey)) throw notFound('Staff member');
  const scope = auth.branchesFor(permission);
  if (scope === 'ALL') return;
  if (target.roleKey === 'SUPER_ADMIN') throw notFound('Staff member');
  if (!target.branches.some((b) => scope.includes(b.toString()))) throw notFound('Staff member');
}

/** Visible, and strictly lower rank, unless the caller is a super admin. */
function assertManageable(auth: AuthContext, target: UserDoc, permission: Permission) {
  assertVisible(auth, target, permission);
  if (auth.role !== 'SUPER_ADMIN' && ROLE_RANK[target.roleKey] >= auth.rank) {
    throw forbidden('You can only manage staff below your own role.');
  }
}

function assertCanAssignRole(auth: AuthContext, role: RoleKey) {
  if (auth.role !== 'SUPER_ADMIN' && ROLE_RANK[role] >= auth.rank) {
    throw forbidden('You can only assign roles below your own.');
  }
}

async function assertNotLastSuperAdmin(target: UserDoc) {
  if (target.roleKey !== 'SUPER_ADMIN' || target.status !== 'active') return;
  const others = await User.countDocuments({ roleKey: 'SUPER_ADMIN', status: 'active', _id: { $ne: target._id } });
  if (others === 0) throw badRequest('There must always be at least one active Super Admin.', undefined, 'LAST_SUPER_ADMIN');
}

/** Checks branch rules for a role and that the caller may place staff in those branches. */
async function validateBranchesForRole(auth: AuthContext, role: RoleKey, branches: string[], permission: Permission) {
  if (role === 'SUPER_ADMIN') {
    if (branches.length) throw badRequest('Super Admins work across all branches and are not assigned to specific ones.');
    return;
  }
  if (BRANCH_BOUND_ROLES.includes(role) && branches.length === 0) {
    throw badRequest('Assign at least one branch.', { branches: ['Assign at least one branch'] }, 'BRANCHES_REQUIRED');
  }
  await requireBranches(branches, { activeOnly: true });
  if (!auth.canAccessAllBranches(permission, branches)) {
    throw forbidden('You can only assign staff to your own branches.');
  }
}

/**
 * Keeps Branch.admins in step with users. The list holds active branch admins
 * assigned to the branch.
 */
export async function syncBranchAdmins(userId: Types.ObjectId): Promise<void> {
  const user = await User.findById(userId).select('roleKey status branches').lean();
  await Branch.updateMany({ admins: userId }, { $pull: { admins: userId } });
  if (user && user.roleKey === 'BRANCH_ADMIN' && user.status === 'active' && user.branches.length) {
    await Branch.updateMany({ _id: { $in: user.branches } }, { $addToSet: { admins: userId } });
  }
}

async function assertUniqueContact(email: string | undefined, phone: string | undefined, exceptId?: Types.ObjectId) {
  const or: Record<string, string>[] = [];
  if (email) or.push({ email });
  if (phone) or.push({ phone });
  if (!or.length) return;
  const clash = await User.findOne({ $or: or, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).select('email phone').lean();
  if (clash) {
    const field = email && clash.email === email ? 'email' : 'phone';
    throw conflict(`Another account already uses this ${field}.`, { [field]: [`Already in use`] }, 'DUPLICATE');
  }
}

type ListQuery = z.output<typeof listUsersQuery>;

export async function listStaff(auth: AuthContext, q: ListQuery): Promise<Page<StaffDto>> {
  const scope = auth.branchesFor(P.USERS_READ);
  const filter: Record<string, unknown> = { roleKey: { $in: STAFF_ROLE_KEYS } };
  if (scope !== 'ALL') {
    filter.roleKey = { $in: ['BRANCH_ADMIN', 'SALES_STAFF'] };
    filter.branches = { $in: scope.map((id) => new Types.ObjectId(id)) };
  }
  if (q.role) {
    if (scope !== 'ALL' && q.role === 'SUPER_ADMIN') return Page.of([], 0, q.page, q.limit);
    filter.roleKey = q.role;
  }
  if (q.status) filter.status = q.status;
  if (q.branch) {
    if (scope !== 'ALL' && !scope.includes(q.branch)) return Page.of([], 0, q.page, q.limit);
    filter.branches = new Types.ObjectId(q.branch);
  }
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ fullName: rx }, { email: rx }, { phone: rx }];
  }
  const [items, total, names] = await Promise.all([
    User.find(filter)
      .sort({ status: 1, fullName: 1 })
      .skip(skipFor(q.page, q.limit))
      .limit(q.limit)
      .populate({ path: 'branches', select: 'name code' })
      .populate({ path: 'branchAccessGrants.branch', select: 'name code' })
      .populate({ path: 'branchAccessGrants.grantedBy', select: 'fullName' })
      .lean<PopulatedUser[]>(),
    User.countDocuments(filter),
    roleNames(),
  ]);
  return Page.of(items.map((u) => toStaffDto(u, names)), total, q.page, q.limit);
}

export async function getStaff(auth: AuthContext, id: string): Promise<StaffDto> {
  const user = await User.findById(id).select('roleKey branches').lean();
  if (!user) throw notFound('Staff member');
  assertVisible(auth, user, P.USERS_READ);
  return loadStaffDto(id);
}

export async function createStaff(
  auth: AuthContext,
  input: z.output<typeof createStaffSchema>,
  meta: RequestMeta,
): Promise<StaffDto> {
  assertCanAssignRole(auth, input.role);
  await validateBranchesForRole(auth, input.role, input.branches, P.USERS_CREATE);
  const passwordHash = await hashPassword(input.temporaryPassword);

  const id = await withTransaction(async () => {
    await assertUniqueContact(input.email, input.phone);
    const role = await getRoleByKey(input.role);
    const [user] = await User.create([
      {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        passwordHash,
        role: role._id,
        roleKey: role.key,
        branches: input.branches,
        mustChangePassword: true,
        createdBy: auth.userId,
      },
    ]);
    await syncBranchAdmins(user!._id);
    if (user!.email) {
      await queueEmail(staffWelcomeEmail(user!.email, user!.fullName, role.name, `${env.WEB_URL}/login`));
    }
    await audit(
      {
        action: 'user.created',
        actor: auth,
        branch: input.branches[0] ?? null,
        entity: { kind: 'User', id: user!._id, label: user!.fullName },
        after: pick(user, AUDIT_FIELDS),
      },
      meta,
    );
    return user!._id;
  });
  return loadStaffDto(id);
}

export async function updateStaff(
  auth: AuthContext,
  id: string,
  input: z.output<typeof updateStaffSchema>,
  meta: RequestMeta,
): Promise<StaffDto> {
  await withTransaction(async () => {
    const user = await User.findById(id);
    if (!user) throw notFound('Staff member');
    assertManageable(auth, user, P.USERS_UPDATE);
    const before = pick(user, AUDIT_FIELDS);

    const newRole = input.role ?? user.roleKey;
    const roleChanging = newRole !== user.roleKey;
    if (roleChanging) {
      if (user._id.equals(auth.userId)) throw forbidden('You cannot change your own role.');
      assertCanAssignRole(auth, newRole);
      if (user.roleKey === 'SUPER_ADMIN') await assertNotLastSuperAdmin(user);
    }
    if (input.branches && !auth.can(P.USERS_ASSIGN_BRANCHES)) {
      throw forbidden('Only the Super Admin can change branch assignments.');
    }
    let branches = input.branches ?? user.branches.map(String);
    if (newRole === 'SUPER_ADMIN') branches = [];
    if (roleChanging || input.branches) {
      await validateBranchesForRole(auth, newRole, branches, input.branches ? P.USERS_ASSIGN_BRANCHES : P.USERS_UPDATE);
    }

    await assertUniqueContact(input.email, input.phone, user._id);
    if (input.fullName !== undefined) user.fullName = input.fullName;
    if (input.email !== undefined) user.email = input.email;
    if (input.phone !== undefined) user.phone = input.phone;
    if (roleChanging) {
      const role = await getRoleByKey(newRole);
      user.role = role._id;
      user.roleKey = role.key;
      if (newRole === 'SUPER_ADMIN') user.branchAccessGrants.splice(0);
    }
    const current = user.branches.map(String).sort().join(',');
    if ([...branches].sort().join(',') !== current) {
      user.branches = branches.map((b) => new Types.ObjectId(b));
    }
    if (!user.isModified()) return;
    await user.save();
    await syncBranchAdmins(user._id);
    await audit(
      {
        action: roleChanging ? 'user.role_changed' : 'user.updated',
        actor: auth,
        branch: user.branches[0] ?? null,
        entity: { kind: 'User', id: user._id, label: user.fullName },
        before,
        after: pick(user, AUDIT_FIELDS),
      },
      meta,
    );
  });
  return loadStaffDto(id);
}

export async function setStaffStatus(
  auth: AuthContext,
  id: string,
  status: UserStatus,
  meta: RequestMeta,
): Promise<StaffDto> {
  await withTransaction(async () => {
    const user = await User.findById(id);
    if (!user) throw notFound('Staff member');
    assertManageable(auth, user, P.USERS_DEACTIVATE);
    if (user._id.equals(auth.userId)) throw forbidden('You cannot change the status of your own account.');
    if (user.status === status) throw badRequest(`This account is already ${status}.`);
    if (status !== 'active') await assertNotLastSuperAdmin(user);
    const before = { status: user.status };
    user.status = status;
    if (status === 'active') {
      user.failedLoginCount = 0;
      user.lockedUntil = undefined;
    }
    await user.save();
    if (status !== 'active') await revokeAllSessions(user._id, `account_${status}`);
    await syncBranchAdmins(user._id);
    await audit(
      {
        action: `user.${status === 'active' ? 'activated' : status}`,
        actor: auth,
        branch: user.branches[0] ?? null,
        entity: { kind: 'User', id: user._id, label: user.fullName },
        before,
        after: { status },
      },
      meta,
    );
  });
  return loadStaffDto(id);
}

export async function adminResetPassword(
  auth: AuthContext,
  id: string,
  temporaryPassword: string,
  meta: RequestMeta,
): Promise<StaffDto> {
  const passwordHash = await hashPassword(temporaryPassword);
  await withTransaction(async () => {
    const user = await User.findById(id);
    if (!user) throw notFound('Staff member');
    assertManageable(auth, user, P.USERS_RESET_PASSWORD);
    if (user._id.equals(auth.userId)) throw forbidden('Use "Change password" to change your own password.');
    user.passwordHash = passwordHash;
    user.mustChangePassword = true;
    user.failedLoginCount = 0;
    user.lockedUntil = undefined;
    user.passwordChangedAt = new Date();
    await user.save();
    await revokeAllSessions(user._id, 'admin_password_reset');
    await audit(
      {
        action: 'user.password_reset_by_admin',
        actor: auth,
        branch: user.branches[0] ?? null,
        entity: { kind: 'User', id: user._id, label: user.fullName },
      },
      meta,
    );
  });
  return loadStaffDto(id);
}

export async function assignBranches(
  auth: AuthContext,
  id: string,
  branches: string[],
  meta: RequestMeta,
): Promise<StaffDto> {
  return updateStaff(auth, id, { branches }, meta);
}

export async function addBranchGrant(
  auth: AuthContext,
  id: string,
  input: z.output<typeof branchAccessGrantSchema>,
  meta: RequestMeta,
): Promise<StaffDto> {
  await withTransaction(async () => {
    const user = await User.findById(id);
    if (!user) throw notFound('Staff member');
    assertManageable(auth, user, P.USERS_GRANT_ACCESS);
    if (user.roleKey !== 'BRANCH_ADMIN' && user.roleKey !== 'SALES_STAFF') {
      throw badRequest('Branch access grants apply only to branch admins and sales staff.');
    }
    await requireBranches([input.branch], { activeOnly: true });
    if (user.branches.some((b) => b.equals(input.branch))) {
      throw badRequest('This staff member is already assigned to that branch.');
    }
    const role = await Role.findById(user.role).select('permissions').lean();
    const allowed = new Set(role?.permissions ?? []);
    const invalid = input.permissions.filter((p) => !allowed.has(p) || COMPANY_ONLY_PERMISSIONS.includes(p));
    if (invalid.length) {
      throw badRequest("A grant can only extend permissions that the staff member's role already has.", { permissions: invalid });
    }
    // Replace any existing grant for the same branch.
    const existing = user.branchAccessGrants.find((g) => g.branch.equals(input.branch));
    if (existing) existing.deleteOne();
    user.branchAccessGrants.push({
      branch: new Types.ObjectId(input.branch),
      permissions: [...new Set(input.permissions)],
      expiresAt: input.expiresAt,
      reason: input.reason,
      grantedBy: new Types.ObjectId(auth.userId),
    });
    await user.save();
    await audit(
      {
        action: 'user.branch_access_granted',
        actor: auth,
        branch: input.branch,
        entity: { kind: 'User', id: user._id, label: user.fullName },
        after: { branch: input.branch, permissions: input.permissions, expiresAt: input.expiresAt, reason: input.reason },
      },
      meta,
    );
  });
  return loadStaffDto(id);
}

export async function removeBranchGrant(auth: AuthContext, id: string, grantId: string, meta: RequestMeta): Promise<StaffDto> {
  await withTransaction(async () => {
    const user = await User.findById(id);
    if (!user) throw notFound('Staff member');
    assertManageable(auth, user, P.USERS_GRANT_ACCESS);
    const grant = user.branchAccessGrants.id(grantId);
    if (!grant) throw notFound('Access grant');
    const before = pick(grant, ['branch', 'permissions', 'expiresAt', 'reason']);
    grant.deleteOne();
    await user.save();
    await audit(
      {
        action: 'user.branch_access_revoked',
        actor: auth,
        branch: before.branch as string,
        entity: { kind: 'User', id: user._id, label: user.fullName },
        before,
      },
      meta,
    );
  });
  return loadStaffDto(id);
}
