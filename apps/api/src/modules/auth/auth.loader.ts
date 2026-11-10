import type { Permission, RoleKey, RoleScope } from '@mb/shared';
import { Types } from 'mongoose';
import { AuthContext } from '../../core/auth/AuthContext';
import { Role } from '../roles/role.model';
import { User } from '../users/user.model';
import { Session } from './session.model';

const SESSION_TOUCH_INTERVAL_MS = 5 * 60_000;

/**
 * Builds the AuthContext for a token's user and session, or returns null when the session
 * was revoked or expired, or the user is no longer active.
 */
export async function loadAuthContext(userId: string, sessionId: string): Promise<AuthContext | null> {
  if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(sessionId)) return null;
  const now = new Date();
  const [session, user] = await Promise.all([
    Session.findOne({ _id: sessionId, user: userId, revokedAt: { $exists: false }, expiresAt: { $gt: now } })
      .select('lastUsedAt')
      .lean(),
    User.findById(userId)
      .select('fullName roleKey role branches branchAccessGrants customer status mustChangePassword')
      .lean(),
  ]);
  if (!session || !user || user.status !== 'active') return null;

  const role = await Role.findById(user.role).select('key name scope permissions').lean();
  if (!role) return null;

  if (now.getTime() - new Date(session.lastUsedAt).getTime() > SESSION_TOUCH_INTERVAL_MS) {
    void Session.updateOne({ _id: sessionId }, { $set: { lastUsedAt: now } }).exec().catch(() => undefined);
  }

  return buildAuthContext(user, role, sessionId);
}

interface UserLike {
  _id: Types.ObjectId;
  fullName: string;
  roleKey: RoleKey;
  branches?: Types.ObjectId[];
  branchAccessGrants?: { branch: Types.ObjectId; permissions: Permission[]; expiresAt: Date }[];
  customer?: Types.ObjectId | null;
  mustChangePassword?: boolean;
}

interface RoleLike {
  key: RoleKey;
  name: string;
  scope: RoleScope;
  permissions: Permission[];
}

export function buildAuthContext(user: UserLike, role: RoleLike, sessionId: string): AuthContext {
  const now = Date.now();
  return new AuthContext({
    userId: user._id.toString(),
    sessionId,
    fullName: user.fullName,
    role: role.key,
    roleName: role.name,
    scope: role.scope,
    rolePermissions: new Set(role.permissions),
    branches: role.scope === 'branch' ? (user.branches ?? []).map(String) : [],
    grants: (user.branchAccessGrants ?? [])
      .filter((g) => new Date(g.expiresAt).getTime() > now)
      .map((g) => ({ branch: g.branch.toString(), permissions: g.permissions, expiresAt: new Date(g.expiresAt) })),
    customerId: user.customer ? user.customer.toString() : null,
    mustChangePassword: Boolean(user.mustChangePassword),
  });
}
