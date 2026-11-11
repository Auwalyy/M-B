import type { Request } from 'express';
import { env } from '../../config/env';
import { forbidden } from '../errors/AppError';

/**
 * Cookie-authenticated endpoints reject requests from other sites. This adds to SameSite=Lax
 * as protection against cross-site request forgery.
 */
export function assertTrustedOrigin(req: Request): void {
  const origin = req.get('origin');
  if (origin && !env.corsOrigins.includes(origin)) throw forbidden('Request origin not allowed.', 'ORIGIN_NOT_ALLOWED');
}
