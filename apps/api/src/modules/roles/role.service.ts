import {
  COMPANY_ONLY_PERMISSIONS,
  DEFAULT_ROLES,
  type Permission,
  type RoleDto,
  type RoleKey,
  type UpdateRoleInput,
  type updateRoleSchema,
} from '@mb/shared';
import type { z } from 'zod';
import type { AuthContext } from '../../core/auth/AuthContext';
import { badRequest, notFound } from '../../core/errors/AppError';
import type { RequestMeta } from '../../core/http/route';
import { withTransaction } from '../../core/db/transaction';
import { audit, pick } from '../audit/audit.service';
import { User } from '../users/user.model';
import { Role, type RoleDoc } from './role.model';

/**
 * Creates any missing system roles. Roles nobody has customised are kept in step with the
 * defaults, so permissions added in later phases reach existing installations.
 * The super admin role always holds every permission.
 */
export async function ensureSystemRoles(): Promise<void> {
  for (const def of DEFAULT_ROLES) {
    const existing = await Role.findOne({ key: def.key });
    if (!existing) {
      await Role.create({ ...def, isSystem: true, customized: false });
      continue;
    }
    if (def.key === 'SUPER_ADMIN' || !existing.customized) {
      existing.permissions = def.permissions;
      existing.scope = def.scope;
      if (existing.isModified()) await existing.save();
    }
  }
}

export async function getRoleByKey(key: RoleKey): Promise<RoleDoc> {
  const role = await Role.findOne({ key });
  if (!role) throw new Error(`System role ${key} is missing. Run ensureSystemRoles().`);
  return role;
}

function toDto(role: RoleDoc, userCount?: number): RoleDto {
  return {
    id: role._id.toString(),
    key: role.key,
    name: role.name,
    description: role.description,
    scope: role.scope,
    permissions: [...role.permissions].sort(),
    isSystem: role.isSystem,
    customized: role.customized,
    userCount,
  };
}

export async function listRoles(): Promise<RoleDto[]> {
  const [roles, counts] = await Promise.all([
    Role.find().sort({ createdAt: 1 }),
    User.aggregate<{ _id: string; n: number }>([
      { $match: { status: { $ne: 'deactivated' } } },
      { $group: { _id: '$roleKey', n: { $sum: 1 } } },
    ]),
  ]);
  const byKey = new Map(counts.map((c) => [c._id, c.n]));
  return roles.map((r) => toDto(r, byKey.get(r.key) ?? 0));
}

export async function updateRole(
  id: string,
  input: z.output<typeof updateRoleSchema> | UpdateRoleInput,
  auth: AuthContext,
  meta: RequestMeta,
): Promise<RoleDto> {
  return withTransaction(async () => {
    const role = await Role.findById(id);
    if (!role) throw notFound('Role');
    const before = pick(role, ['name', 'description', 'permissions']);

    if (input.permissions) {
      if (role.key === 'SUPER_ADMIN') {
        throw badRequest('The Super Admin role always has every permission and cannot be edited.');
      }
      if (role.scope === 'self') {
        throw badRequest('Customer accounts cannot be given staff permissions.');
      }
      const forbiddenPerms = input.permissions.filter((p) => COMPANY_ONLY_PERMISSIONS.includes(p as Permission));
      if (role.scope !== 'company' && forbiddenPerms.length) {
        throw badRequest('Some permissions can only be held by company-wide roles.', { permissions: forbiddenPerms });
      }
      role.permissions = [...new Set(input.permissions as Permission[])];
      role.customized = true;
    }
    if (input.name !== undefined) role.name = input.name;
    if (input.description !== undefined) role.description = input.description;
    await role.save();

    await audit(
      {
        action: 'role.updated',
        actor: auth,
        entity: { kind: 'Role', id: role._id, label: role.name },
        before,
        after: pick(role, ['name', 'description', 'permissions']),
      },
      meta,
    );
    return toDto(role);
  });
}

/** Restore a role's default permissions. */
export async function resetRole(id: string, auth: AuthContext, meta: RequestMeta): Promise<RoleDto> {
  return withTransaction(async () => {
    const role = await Role.findById(id);
    if (!role) throw notFound('Role');
    const def = DEFAULT_ROLES.find((d) => d.key === role.key);
    if (!def) throw badRequest('This role has no defaults to restore.');
    const before = pick(role, ['permissions']);
    role.permissions = def.permissions;
    role.customized = false;
    await role.save();
    await audit(
      { action: 'role.reset', actor: auth, entity: { kind: 'Role', id: role._id, label: role.name }, before, after: pick(role, ['permissions']) },
      meta,
    );
    return toDto(role);
  });
}
