import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { RateLimitName } from '../http/route';

export interface RateLimitConfig {
  globalPerMinute: number;
  authPer15Min: number;
}

function limitedResponse(message: string): RequestHandler {
  return (req, res) => {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message, requestId: req.id } });
  };
}

/**
 * Rate limiters. The default store is in memory, which suits a single API instance.
 * When running several instances, switch to a shared store (Redis or MongoDB).
 */
export function createRateLimiters(cfg: RateLimitConfig) {
  const global = rateLimit({
    windowMs: 60_000,
    limit: cfg.globalPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: limitedResponse('Too many requests. Please slow down and try again shortly.'),
  });

  const named: Record<RateLimitName, RequestHandler> = {
    // Sign-in, registration and password-reset endpoints.
    auth: rateLimit({
      windowMs: 15 * 60_000,
      limit: cfg.authPer15Min,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: limitedResponse('Too many attempts. Please wait 15 minutes and try again.'),
    }),
    // Other abuse-prone public endpoints (enquiry forms, checkout).
    sensitive: rateLimit({
      windowMs: 60_000,
      limit: 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: limitedResponse('Too many requests. Please wait a minute and try again.'),
    }),
  };

  return { global, named };
}
