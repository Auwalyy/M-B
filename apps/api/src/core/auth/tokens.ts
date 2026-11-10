import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../config/env';

const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const AUDIENCE = 'mb-web';

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

/** Returns null for any invalid, expired or tampered token. */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: env.JWT_ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}

/** URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored as SHA-256 hashes, so a database leak does not expose live tokens. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Refresh cookie value: `<sessionId>.<secret>`. */
export function encodeRefreshToken(sessionId: string, secretPart: string): string {
  return `${sessionId}.${secretPart}`;
}

export function decodeRefreshToken(value: unknown): { sessionId: string; secret: string } | null {
  if (typeof value !== 'string') return null;
  const m = /^([a-f\d]{24})\.([A-Za-z0-9_-]{20,100})$/.exec(value);
  return m ? { sessionId: m[1]!, secret: m[2]! } : null;
}
