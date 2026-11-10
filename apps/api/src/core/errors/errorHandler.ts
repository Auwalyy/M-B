import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { ZodError } from 'zod';
import { logger } from '../../config/logger';
import { AppError } from './AppError';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `No endpoint for ${req.method} ${req.path}`));
};

/** Converts zod issues to `{ field.path: [messages] }`. */
export function zodDetails(err: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

interface MongoServerErrorLike {
  code?: number;
  keyValue?: Record<string, unknown>;
  keyPattern?: Record<string, unknown>;
}

function normalise(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new AppError(422, 'VALIDATION_ERROR', 'Some fields are invalid', zodDetails(err));
  }
  const mongoErr = err as MongoServerErrorLike;
  if (mongoErr?.code === 11000) {
    const fields = Object.keys(mongoErr.keyPattern ?? mongoErr.keyValue ?? {});
    const field = fields[0] ?? 'value';
    return new AppError(409, 'DUPLICATE', `A record with this ${field} already exists`, { fields });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const details: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(err.errors)) details[k] = [v.message];
    return new AppError(422, 'VALIDATION_ERROR', 'Some fields are invalid', details);
  }
  if (err instanceof mongoose.Error.CastError) {
    return new AppError(400, 'BAD_REQUEST', `Invalid value for ${err.path}`);
  }
  if (err instanceof mongoose.Error.VersionError) {
    return new AppError(409, 'STALE_RECORD', 'This record was changed by someone else. Reload and try again.');
  }
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return new AppError(413, 'FILE_TOO_LARGE', 'Each image must be 5 MB or smaller.');
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return new AppError(400, 'TOO_MANY_FILES', 'Too many files in one upload.');
    return new AppError(400, 'UPLOAD_INVALID', err.message);
  }
  const httpErr = err as { type?: string; status?: number; statusCode?: number };
  if (httpErr?.type === 'entity.parse.failed') {
    return new AppError(400, 'MALFORMED_JSON', 'The request body is not valid JSON');
  }
  if (httpErr?.type === 'entity.too.large') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large');
  }
  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again.');
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appErr = normalise(err);
  if (appErr.status >= 500) {
    logger.error({ err, requestId: req.id, path: req.path }, 'Unhandled error');
  }
  if (res.headersSent) return;
  res.status(appErr.status).json({
    error: {
      code: appErr.code,
      message: appErr.message,
      ...(appErr.details !== undefined ? { details: appErr.details } : {}),
      requestId: req.id,
    },
  });
};
