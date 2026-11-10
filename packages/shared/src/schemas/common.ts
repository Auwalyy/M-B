import { z } from 'zod';
import { normalizePhone } from '../phone';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const idParams = z.object({ id: objectId });

/** Trimmed, non-empty string with a maximum length. */
export const text = (max = 200) => z.string().trim().min(1, 'Required').max(max);

/** Optional trimmed string; an empty string becomes undefined. */
export const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

export const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));

/** Accepts common Nigerian formats and outputs E.164. */
export const phone = z
  .string()
  .trim()
  .min(1, 'Required')
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number, e.g. 0803 123 4567' });
      return z.NEVER;
    }
    return n;
  });

export const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Use at least one letter and one number');

export const queryBoolean = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}
