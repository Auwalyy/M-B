import { Types } from 'mongoose';
import { env } from '../../config/env';
import { encodeRefreshToken, hashToken, randomToken } from '../../core/auth/tokens';
import type { RequestMeta } from '../../core/http/route';
import { Session } from './session.model';

export async function createSession(userId: Types.ObjectId | string, meta: RequestMeta) {
  const secret = randomToken();
  const session = new Session({
    user: userId,
    tokenHash: hashToken(secret),
    userAgent: meta.userAgent,
    ip: meta.ip,
    lastUsedAt: new Date(),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  });
  await session.save();
  return { session, refreshToken: encodeRefreshToken(session._id.toString(), secret) };
}

export async function revokeAllSessions(
  userId: Types.ObjectId | string,
  reason: string,
  exceptSessionId?: string,
): Promise<number> {
  const filter: Record<string, unknown> = { user: new Types.ObjectId(String(userId)), revokedAt: { $exists: false } };
  if (exceptSessionId) filter._id = { $ne: new Types.ObjectId(exceptSessionId) };
  const res = await Session.updateMany(filter, { $set: { revokedAt: new Date(), revokedReason: reason } });
  return res.modifiedCount;
}
