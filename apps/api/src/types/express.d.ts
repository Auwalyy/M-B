import type { AuthContext } from '../core/auth/AuthContext';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id, echoed in the X-Request-Id header and in error responses. */
      id: string;
      /** Set by the authenticate middleware. */
      auth?: AuthContext;
    }
  }
}

export {};
