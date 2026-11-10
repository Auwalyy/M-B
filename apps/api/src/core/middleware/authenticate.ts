import type { RequestHandler } from 'express';
import { loadAuthContext } from '../../modules/auth/auth.loader';
import { forbidden, unauthorized } from '../errors/AppError';
import { verifyAccessToken } from '../auth/tokens';

interface Options {
  optional?: boolean;
  allowPendingPasswordChange?: boolean;
}

/**
 * Reads the Bearer access token, verifies it, checks the session is still live and the user
 * is still active, and attaches `req.auth`. The session and user are loaded on every request,
 * so sign-out, deactivation and permission changes take effect immediately.
 */
export function authenticate(options: Options = {}): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization');
    if (!header) {
      if (options.optional) return next();
      return next(unauthorized());
    }
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const claims = match ? await verifyAccessToken(match[1]!) : null;
    if (!claims) return next(unauthorized('Your session has expired. Please sign in again.', 'TOKEN_INVALID'));

    const auth = await loadAuthContext(claims.userId, claims.sessionId);
    if (!auth) return next(unauthorized('Your session has ended. Please sign in again.', 'SESSION_INVALID'));

    if (auth.mustChangePassword && !options.allowPendingPasswordChange) {
      return next(forbidden('You must change your password before continuing.', 'PASSWORD_CHANGE_REQUIRED'));
    }
    req.auth = auth;
    next();
  };
}
