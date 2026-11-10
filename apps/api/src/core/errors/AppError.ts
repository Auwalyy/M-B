/**
 * Application errors carry an HTTP status and a stable machine-readable code.
 * The error handler turns them into `{ error: { code, message, details, requestId } }`.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown, code = 'BAD_REQUEST') =>
  new AppError(400, code, message, details);

export const unauthorized = (message = 'Please sign in to continue', code = 'UNAUTHENTICATED') =>
  new AppError(401, code, message);

export const forbidden = (message = 'You do not have permission to do this', code = 'FORBIDDEN') =>
  new AppError(403, code, message);

/** Also used for records outside the caller's branch scope, so their existence is not revealed. */
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);

export const conflict = (message: string, details?: unknown, code = 'CONFLICT') =>
  new AppError(409, code, message, details);

export const unprocessable = (message: string, details?: unknown, code = 'VALIDATION_ERROR') =>
  new AppError(422, code, message, details);

export const tooManyRequests = (message = 'Too many requests. Please try again shortly.') =>
  new AppError(429, 'RATE_LIMITED', message);
