import {
  type AuthResponseDto,
  type AuthUserDto,
  type Permission,
  type SessionDto,
  normalizePhone,
  type changePasswordSchema,
  type loginSchema,
  type registerSchema,
  type resetPasswordSchema,
  type updateProfileSchema,
} from '@mb/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { env } from '../../config/env';
import type { AuthContext } from '../../core/auth/AuthContext';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../core/auth/password';
import {
  decodeRefreshToken,
  encodeRefreshToken,
  hashToken,
  randomToken,
  safeEqualHex,
  signAccessToken,
} from '../../core/auth/tokens';
import { withTransaction } from '../../core/db/transaction';
import { AppError, badRequest, conflict, notFound, unauthorized } from '../../core/errors/AppError';
import type { RequestMeta } from '../../core/http/route';
import { queueEmail } from '../../core/mail/mailer';
import { passwordChangedEmail, passwordResetEmail } from '../../core/mail/templates';
import { audit } from '../audit/audit.service';
import { Customer } from '../customers/customer.model';
import { Role } from '../roles/role.model';
import { getRoleByKey } from '../roles/role.service';
import { User } from '../users/user.model';
import { buildAuthContext } from './auth.loader';
import { PasswordResetToken, Session } from './session.model';
import { createSession, revokeAllSessions } from './session.service';

const RESET_TOKEN_MINUTES = 60;
/** A rotated refresh token presented again within this window is treated as a race between tabs, not theft. */
const REFRESH_RACE_WINDOW_MS = 30_000;

export interface AuthResult {
  response: AuthResponseDto;
  refreshToken: string;
}

interface PopulatedRefs {
  branches: { _id: Types.ObjectId; name: string; code: string }[];
  branchAccessGrants: {
    _id: Types.ObjectId;
    branch: { _id: Types.ObjectId; name: string; code: string } | null;
    permissions: Permission[];
    expiresAt: Date;
    reason: string;
    grantedBy: { _id: Types.ObjectId; fullName: string } | null;
    createdAt: Date;
  }[];
}

/** The signed-in user's profile with effective permissions and branch scope. */
export async function buildAuthUser(userId: string | Types.ObjectId, sessionId: string): Promise<AuthUserDto> {
  const [raw, populated] = await Promise.all([
    User.findById(userId).lean(),
    User.findById(userId)
      .select('branches branchAccessGrants')
      .populate({ path: 'branches', select: 'name code' })
      .populate({ path: 'branchAccessGrants.branch', select: 'name code' })
      .populate({ path: 'branchAccessGrants.grantedBy', select: 'fullName' })
      .lean<PopulatedRefs>(),
  ]);
  if (!raw || !populated) throw notFound('User');
  const role = await Role.findById(raw.role).lean();
  if (!role) throw notFound('Role');
  const ctx = buildAuthContext(raw, role, sessionId);
  const now = Date.now();
  return {
    id: raw._id.toString(),
    fullName: raw.fullName,
    email: raw.email ?? null,
    phone: raw.phone ?? null,
    avatarUrl: raw.avatarUrl ?? null,
    role: role.key,
    roleName: role.name,
    scope: role.scope,
    permissions: ctx.effectivePermissions(),
    branches: role.scope === 'branch'
      ? populated.branches.filter(Boolean).map((b) => ({ id: b._id.toString(), name: b.name, code: b.code }))
      : [],
    grants: populated.branchAccessGrants
      .filter((g) => g.branch && new Date(g.expiresAt).getTime() > now)
      .map((g) => ({
        id: g._id.toString(),
        branch: { id: g.branch!._id.toString(), name: g.branch!.name, code: g.branch!.code },
        permissions: g.permissions,
        expiresAt: new Date(g.expiresAt).toISOString(),
        reason: g.reason,
        grantedBy: g.grantedBy ? { id: g.grantedBy._id.toString(), fullName: g.grantedBy.fullName } : null,
        createdAt: new Date(g.createdAt).toISOString(),
      })),
    customerId: raw.customer?.toString() ?? null,
    mustChangePassword: Boolean(raw.mustChangePassword),
    lastLoginAt: raw.lastLoginAt ? new Date(raw.lastLoginAt).toISOString() : null,
  };
}

async function issueTokens(userId: Types.ObjectId, sessionId: string, refreshToken: string): Promise<AuthResult> {
  const accessToken = await signAccessToken({ userId: userId.toString(), sessionId });
  return {
    refreshToken,
    response: { accessToken, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS, user: await buildAuthUser(userId, sessionId) },
  };
}

// ---------------------------------------------------------------- registration

export async function register(input: z.output<typeof registerSchema>, meta: RequestMeta): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password);
  const { userId, sessionId, refreshToken } = await withTransaction(async () => {
    const clash = await User.findOne({
      $or: [{ phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])],
    }).select('phone email').lean();
    if (clash) {
      const field = clash.phone === input.phone ? 'phone' : 'email';
      throw conflict(`An account with this ${field} already exists. Sign in instead.`, { [field]: ['Already registered'] }, 'ACCOUNT_EXISTS');
    }
    if (input.email) {
      const emailOwner = await Customer.findOne({ email: input.email, phone: { $ne: input.phone } }).select('_id').lean();
      if (emailOwner) throw conflict('This email belongs to another customer record.', { email: ['Already in use'] }, 'ACCOUNT_EXISTS');
    }

    // A customer may already exist (served in a branch, or checked out as a guest): link to that record.
    let customer = await Customer.findOne({ phone: input.phone });
    if (customer?.user) throw conflict('An account with this phone already exists. Sign in instead.', undefined, 'ACCOUNT_EXISTS');
    if (!customer) {
      customer = new Customer({ fullName: input.fullName, phone: input.phone, email: input.email, source: 'online' });
    } else {
      customer.fullName = input.fullName;
      if (input.email) customer.email = input.email;
    }

    const role = await getRoleByKey('CUSTOMER');
    const user = new User({
      fullName: input.fullName,
      phone: input.phone,
      email: input.email,
      passwordHash,
      role: role._id,
      roleKey: 'CUSTOMER',
      customer: customer._id,
      lastLoginAt: new Date(),
    });
    customer.user = user._id;
    await customer.save();
    await user.save();
    const { session, refreshToken } = await createSession(user._id, meta);
    await audit(
      { action: 'auth.register', actor: { userId: user._id.toString(), role: 'CUSTOMER' }, entity: { kind: 'User', id: user._id, label: user.fullName } },
      meta,
    );
    return { userId: user._id, sessionId: session._id.toString(), refreshToken };
  });
  return issueTokens(userId, sessionId, refreshToken);
}

// ---------------------------------------------------------------- sign in

const INVALID_CREDENTIALS = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'The email/phone or password is incorrect.');

export async function login(input: z.output<typeof loginSchema>, meta: RequestMeta): Promise<AuthResult> {
  const identifier = input.identifier.trim();
  const filter = identifier.includes('@')
    ? { email: identifier.toLowerCase() }
    : (() => {
        const phone = normalizePhone(identifier);
        return phone ? { phone } : null;
      })();

  const user = filter ? await User.findOne(filter).select('+passwordHash') : null;
  if (!user) {
    await verifyAgainstDummy(input.password);
    await audit({ action: 'auth.login_failed', meta: { identifier: identifier.slice(0, 80), reason: 'unknown_account' } }, meta);
    throw INVALID_CREDENTIALS();
  }

  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000);
    throw new AppError(
      423,
      'ACCOUNT_LOCKED',
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or reset your password.`,
    );
  }

  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) {
    const updated = await User.findOneAndUpdate({ _id: user._id }, { $inc: { failedLoginCount: 1 } }, { returnDocument: 'after' });
    const actor = { userId: user._id.toString(), role: user.roleKey };
    if (updated && updated.failedLoginCount >= env.LOGIN_MAX_FAILURES) {
      await User.updateOne(
        { _id: user._id },
        { $set: { lockedUntil: new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000), failedLoginCount: 0 } },
      );
      await audit({ action: 'auth.account_locked', actor, entity: { kind: 'User', id: user._id, label: user.fullName } }, meta);
    } else {
      await audit({ action: 'auth.login_failed', actor, entity: { kind: 'User', id: user._id, label: user.fullName }, meta: { reason: 'wrong_password' } }, meta);
    }
    throw INVALID_CREDENTIALS();
  }

  if (user.status !== 'active') {
    await audit({ action: 'auth.login_blocked', actor: { userId: user._id.toString(), role: user.roleKey }, meta: { status: user.status } }, meta);
    throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is not active. Please contact your administrator.');
  }

  await User.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0, lastLoginAt: now }, $unset: { lockedUntil: 1 } });
  const { session, refreshToken } = await createSession(user._id, meta);
  await audit(
    {
      action: 'auth.login',
      actor: { userId: user._id.toString(), role: user.roleKey },
      branch: user.branches[0] ?? null,
      entity: { kind: 'User', id: user._id, label: user.fullName },
    },
    meta,
  );
  return issueTokens(user._id, session._id.toString(), refreshToken);
}

// ---------------------------------------------------------------- refresh / logout

export async function refresh(cookie: unknown, meta: RequestMeta): Promise<AuthResult> {
  const decoded = decodeRefreshToken(cookie);
  if (!decoded) throw unauthorized('Please sign in.', 'REFRESH_INVALID');
  const now = new Date();
  const session = await Session.findById(decoded.sessionId);
  if (!session || session.revokedAt || session.expiresAt <= now) {
    throw unauthorized('Your session has ended. Please sign in again.', 'REFRESH_INVALID');
  }

  const presented = hashToken(decoded.secret);
  if (!safeEqualHex(presented, session.tokenHash)) {
    if (session.previousTokenHash && safeEqualHex(presented, session.previousTokenHash)) {
      if (session.rotatedAt && now.getTime() - session.rotatedAt.getTime() < REFRESH_RACE_WINDOW_MS) {
        // Another tab refreshed a moment ago; the browser already has the new cookie, so the client retries.
        throw unauthorized('Session refreshed in another tab. Retry.', 'REFRESH_RACE');
      }
      // An old token was replayed: assume it was stolen and end the session.
      await Session.updateOne({ _id: session._id }, { $set: { revokedAt: now, revokedReason: 'refresh_token_reuse' } });
      await audit({ action: 'auth.refresh_reuse_detected', actor: { userId: session.user.toString(), role: 'unknown' }, meta: { sessionId: session._id.toString() } }, meta);
      throw unauthorized('For your security, please sign in again.', 'SESSION_REVOKED');
    }
    throw unauthorized('Please sign in.', 'REFRESH_INVALID');
  }

  const user = await User.findById(session.user).select('status').lean();
  if (!user || user.status !== 'active') {
    await Session.updateOne({ _id: session._id }, { $set: { revokedAt: now, revokedReason: 'user_inactive' } });
    throw unauthorized('This account is not active.', 'SESSION_REVOKED');
  }

  const newSecret = randomToken();
  // Conditional update: if two requests rotate at once, only one succeeds.
  const rotated = await Session.findOneAndUpdate(
    { _id: session._id, tokenHash: presented, revokedAt: { $exists: false } },
    {
      $set: {
        tokenHash: hashToken(newSecret),
        previousTokenHash: presented,
        rotatedAt: now,
        lastUsedAt: now,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    },
  );
  if (!rotated) throw unauthorized('Session refreshed in another tab. Retry.', 'REFRESH_RACE');
  return issueTokens(session.user, session._id.toString(), encodeRefreshToken(session._id.toString(), newSecret));
}

export async function logout(cookie: unknown, meta: RequestMeta): Promise<void> {
  const decoded = decodeRefreshToken(cookie);
  if (!decoded) return;
  const session = await Session.findById(decoded.sessionId);
  if (!session || session.revokedAt) return;
  const presented = hashToken(decoded.secret);
  const matches =
    safeEqualHex(presented, session.tokenHash) ||
    (session.previousTokenHash ? safeEqualHex(presented, session.previousTokenHash) : false);
  if (!matches) return;
  session.revokedAt = new Date();
  session.revokedReason = 'logout';
  await session.save();
  await audit({ action: 'auth.logout', actor: { userId: session.user.toString(), role: 'unknown' } }, meta);
}

// ---------------------------------------------------------------- password reset

export async function forgotPassword(email: string, meta: RequestMeta): Promise<void> {
  const user = await User.findOne({ email, status: 'active' }).select('fullName email roleKey').lean();
  if (!user || !user.email) return; // Same response either way: do not reveal which emails exist.
  const token = randomToken();
  await withTransaction(async () => {
    await PasswordResetToken.deleteMany({ user: user._id, usedAt: { $exists: false } });
    await PasswordResetToken.create([
      { user: user._id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000) },
    ]);
    await queueEmail(
      passwordResetEmail(user.email!, user.fullName, `${env.WEB_URL}/reset-password?token=${encodeURIComponent(token)}`, RESET_TOKEN_MINUTES),
    );
    await audit({ action: 'auth.password_reset_requested', actor: { userId: user._id.toString(), role: user.roleKey } }, meta);
  });
}

export async function resetPassword(input: z.output<typeof resetPasswordSchema>, meta: RequestMeta): Promise<void> {
  const passwordHash = await hashPassword(input.password);
  const invalid = () => badRequest('This reset link is invalid or has expired. Request a new one.', undefined, 'RESET_TOKEN_INVALID');
  await withTransaction(async () => {
    const record = await PasswordResetToken.findOneAndUpdate(
      { tokenHash: hashToken(input.token), usedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
    );
    if (!record) throw invalid();
    const user = await User.findById(record.user);
    if (!user || user.status !== 'active') throw invalid();
    user.passwordHash = passwordHash;
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    user.failedLoginCount = 0;
    user.lockedUntil = undefined;
    await user.save();
    await revokeAllSessions(user._id, 'password_reset');
    if (user.email) await queueEmail(passwordChangedEmail(user.email, user.fullName));
    await audit({ action: 'auth.password_reset', actor: { userId: user._id.toString(), role: user.roleKey }, entity: { kind: 'User', id: user._id, label: user.fullName } }, meta);
  });
}

// ---------------------------------------------------------------- profile

export async function changePassword(
  auth: AuthContext,
  input: z.output<typeof changePasswordSchema>,
  meta: RequestMeta,
): Promise<AuthUserDto> {
  const user = await User.findById(auth.userId).select('+passwordHash');
  if (!user) throw notFound('User');
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw badRequest('Your current password is incorrect.', { currentPassword: ['Incorrect password'] }, 'INVALID_PASSWORD');
  }
  const passwordHash = await hashPassword(input.newPassword);
  await withTransaction(async () => {
    user.passwordHash = passwordHash;
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    await user.save();
    await revokeAllSessions(user._id, 'password_changed', auth.sessionId);
    if (user.email) await queueEmail(passwordChangedEmail(user.email, user.fullName));
    await audit({ action: 'auth.password_changed', actor: auth, entity: { kind: 'User', id: user._id, label: user.fullName } }, meta);
  });
  return buildAuthUser(user._id, auth.sessionId);
}

export async function updateProfile(
  auth: AuthContext,
  input: z.output<typeof updateProfileSchema>,
  meta: RequestMeta,
): Promise<AuthUserDto> {
  await withTransaction(async () => {
    const user = await User.findById(auth.userId);
    if (!user) throw notFound('User');
    const or = [
      ...(input.email && input.email !== user.email ? [{ email: input.email }] : []),
      ...(input.phone && input.phone !== user.phone ? [{ phone: input.phone }] : []),
    ];
    if (or.length) {
      const clash = await User.findOne({ $or: or, _id: { $ne: user._id } }).select('email phone').lean();
      if (clash) {
        const field = input.email && clash.email === input.email ? 'email' : 'phone';
        throw conflict(`Another account already uses this ${field}.`, { [field]: ['Already in use'] }, 'DUPLICATE');
      }
    }
    const before = { fullName: user.fullName, email: user.email, phone: user.phone };
    if (input.fullName !== undefined) user.fullName = input.fullName;
    if (input.email !== undefined) user.email = input.email;
    if (input.phone !== undefined) user.phone = input.phone;
    if (input.avatarUrl !== undefined) user.avatarUrl = input.avatarUrl;
    if (!user.isModified()) return;
    await user.save();

    // Keep the central customer record in step with the account.
    if (user.customer) {
      if (input.phone) {
        const other = await Customer.findOne({ phone: input.phone, _id: { $ne: user.customer } }).select('_id').lean();
        if (other) throw conflict('This phone number belongs to another customer record. Contact support to merge them.', { phone: ['Already in use'] }, 'DUPLICATE');
      }
      await Customer.updateOne(
        { _id: user.customer },
        { $set: { fullName: user.fullName, phone: user.phone, ...(user.email ? { email: user.email } : {}) } },
      );
    }
    await audit(
      {
        action: 'user.profile_updated',
        actor: auth,
        entity: { kind: 'User', id: user._id, label: user.fullName },
        before,
        after: { fullName: user.fullName, email: user.email, phone: user.phone },
      },
      meta,
    );
  });
  return buildAuthUser(auth.userId, auth.sessionId);
}

// ---------------------------------------------------------------- sessions

export async function listSessions(auth: AuthContext): Promise<SessionDto[]> {
  const sessions = await Session.find({ user: auth.userId, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1 })
    .lean();
  return sessions.map((s) => ({
    id: s._id.toString(),
    userAgent: s.userAgent ?? null,
    ip: s.ip ?? null,
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: new Date(s.lastUsedAt).toISOString(),
    current: s._id.toString() === auth.sessionId,
  }));
}

export async function revokeSession(auth: AuthContext, sessionId: string, meta: RequestMeta): Promise<void> {
  const res = await Session.updateOne(
    { _id: new Types.ObjectId(sessionId), user: auth.userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date(), revokedReason: 'revoked_by_user' } },
  );
  if (res.matchedCount === 0) throw notFound('Session');
  await audit({ action: 'auth.session_revoked', actor: auth, meta: { sessionId } }, meta);
}

export async function revokeOtherSessions(auth: AuthContext, meta: RequestMeta): Promise<{ revoked: number }> {
  const revoked = await revokeAllSessions(auth.userId, 'revoked_by_user', auth.sessionId);
  await audit({ action: 'auth.sessions_revoked', actor: auth, meta: { revoked } }, meta);
  return { revoked };
}
