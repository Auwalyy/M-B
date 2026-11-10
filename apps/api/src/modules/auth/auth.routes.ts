import {
  changePasswordSchema,
  forgotPasswordSchema,
  idParams,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from '@mb/shared';
import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { forbidden } from '../../core/errors/AppError';
import type { ModuleRouter } from '../../core/http/route';
import {
  type AuthResult,
  buildAuthUser,
  changePassword,
  forgotPassword,
  listSessions,
  login,
  logout,
  refresh,
  register,
  resetPassword,
  revokeOtherSessions,
  revokeSession,
  updateProfile,
} from './auth.service';

export const REFRESH_COOKIE = 'mb_rt';
const COOKIE_PATH = '/api/v1/auth';

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: COOKIE_PATH,
    domain: env.COOKIE_DOMAIN,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH, domain: env.COOKIE_DOMAIN, httpOnly: true, secure: env.cookieSecure, sameSite: 'lax' });
}

/**
 * Cookie-authenticated endpoints reject requests from other sites. This adds to SameSite=Lax
 * as protection against cross-site request forgery.
 */
function assertTrustedOrigin(req: Request) {
  const origin = req.get('origin');
  if (origin && !env.corsOrigins.includes(origin)) throw forbidden('Request origin not allowed.', 'ORIGIN_NOT_ALLOWED');
}

function respondWithSession(res: Response, result: AuthResult) {
  setRefreshCookie(res, result.refreshToken);
  return result.response;
}

export function registerAuthRoutes(m: ModuleRouter): void {
  m.route({
    method: 'post',
    path: '/register',
    summary: 'Create a customer account (links to an existing customer record with the same phone)',
    auth: 'none',
    rateLimit: 'auth',
    body: registerSchema,
    handler: async ({ req, res, body, meta }) => {
      assertTrustedOrigin(req);
      return respondWithSession(res, await register(body, meta));
    },
  });

  m.route({
    method: 'post',
    path: '/login',
    summary: 'Sign in with email or phone and password',
    description: 'Returns an access token and sets an httpOnly refresh cookie. Accounts lock for a period after repeated failures.',
    auth: 'none',
    rateLimit: 'auth',
    body: loginSchema,
    status: 200,
    handler: async ({ req, res, body, meta }) => {
      assertTrustedOrigin(req);
      return respondWithSession(res, await login(body, meta));
    },
  });

  m.route({
    method: 'post',
    path: '/refresh',
    summary: 'Exchange the refresh cookie for a new access token (rotates the refresh token)',
    auth: 'none',
    status: 200,
    handler: async ({ req, res, meta }) => {
      assertTrustedOrigin(req);
      try {
        return respondWithSession(res, await refresh(req.cookies?.[REFRESH_COOKIE], meta));
      } catch (err) {
        if ((err as { code?: string }).code !== 'REFRESH_RACE') clearRefreshCookie(res);
        throw err;
      }
    },
  });

  m.route({
    method: 'post',
    path: '/logout',
    summary: 'Sign out of this device',
    auth: 'none',
    status: 204,
    handler: async ({ req, res, meta }) => {
      assertTrustedOrigin(req);
      await logout(req.cookies?.[REFRESH_COOKIE], meta);
      clearRefreshCookie(res);
    },
  });

  m.route({
    method: 'post',
    path: '/forgot-password',
    summary: 'Email a password reset link (always responds the same way)',
    auth: 'none',
    rateLimit: 'auth',
    body: forgotPasswordSchema,
    status: 202,
    handler: async ({ body, meta }) => {
      await forgotPassword(body.email, meta);
      return { message: 'If an account exists for this email, a reset link has been sent.' };
    },
  });

  m.route({
    method: 'post',
    path: '/reset-password',
    summary: 'Set a new password using a reset token. Signs out every device.',
    auth: 'none',
    rateLimit: 'auth',
    body: resetPasswordSchema,
    status: 200,
    handler: async ({ body, meta }) => {
      await resetPassword(body, meta);
      return { message: 'Your password has been reset. You can now sign in.' };
    },
  });

  m.route({
    method: 'get',
    path: '/me',
    summary: 'The signed-in user, with role, effective permissions and branches',
    allowPendingPasswordChange: true,
    handler: ({ auth }) => buildAuthUser(auth.userId, auth.sessionId),
  });

  m.route({
    method: 'patch',
    path: '/me',
    summary: 'Update your own profile',
    body: updateProfileSchema,
    handler: ({ auth, body, meta }) => updateProfile(auth, body, meta),
  });

  m.route({
    method: 'post',
    path: '/change-password',
    summary: 'Change your password (signs out your other devices)',
    allowPendingPasswordChange: true,
    rateLimit: 'auth',
    body: changePasswordSchema,
    status: 200,
    handler: ({ auth, body, meta }) => changePassword(auth, body, meta),
  });

  m.route({
    method: 'get',
    path: '/sessions',
    summary: 'Devices where you are signed in',
    allowPendingPasswordChange: true,
    handler: ({ auth }) => listSessions(auth),
  });

  m.route({
    method: 'delete',
    path: '/sessions/:id',
    summary: 'Sign out a specific device',
    allowPendingPasswordChange: true,
    params: idParams,
    status: 204,
    handler: ({ auth, params, meta }) => revokeSession(auth, params.id, meta),
  });

  m.route({
    method: 'post',
    path: '/sessions/revoke-others',
    summary: 'Sign out every other device',
    allowPendingPasswordChange: true,
    status: 200,
    handler: ({ auth, meta }) => revokeOtherSessions(auth, meta),
  });
}
