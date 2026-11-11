import { z } from 'zod';
import { daysInRange } from '../dates';
import { ORDER_CHANNELS, PAYMENT_METHODS } from '../enums';
import { objectId } from './common';

export const MAX_REPORT_DAYS = 731;
export const REPORT_GROUPINGS = ['day', 'week', 'month'] as const;
export type ReportGrouping = (typeof REPORT_GROUPINGS)[number];
export const REPORT_FORMATS = ['json', 'csv'] as const;
export const INVENTORY_STOCK_FILTERS = ['all', 'low', 'out'] as const;
export const CUSTOMER_REPORT_SORTS = ['spent', 'orders', 'recent'] as const;
export const TOP_PRODUCT_MEASURES = ['revenue', 'units'] as const;
/** Most rows one CSV export returns. */
export const CSV_MAX_ROWS = 50_000;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD').refine((d) => {
  // Round-trip, so 2026-02-31 is rejected rather than rolled over to March.
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}, 'Not a real date');

/** Shared by every dated report: an inclusive Lagos-day range and an optional branch. */
const rangeShape = {
  from: day.optional(),
  to: day.optional(),
  branch: objectId.optional(),
};

const pageShape = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  format: z.enum(REPORT_FORMATS).default('json'),
};

function checkRange(r: { from?: string; to?: string }, ctx: z.RefinementCtx) {
  if (r.from && r.to) {
    if (r.from > r.to) ctx.addIssue({ code: 'custom', message: 'The start date must be on or before the end date', path: ['from'] });
    else if (daysInRange(r.from, r.to) > MAX_REPORT_DAYS) ctx.addIssue({ code: 'custom', message: `Choose a range of at most ${MAX_REPORT_DAYS} days`, path: ['from'] });
  }
}

export const analyticsRangeQuery = z.object(rangeShape).superRefine(checkRange);

export const salesSeriesQuery = z.object({ ...rangeShape, groupBy: z.enum(REPORT_GROUPINGS).default('day') }).superRefine(checkRange);

export const topProductsQuery = z
  .object({ ...rangeShape, by: z.enum(TOP_PRODUCT_MEASURES).default('revenue'), limit: z.coerce.number().int().min(1).max(50).default(10) })
  .superRefine(checkRange);

export const branchOnlyQuery = z.object({
  branch: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(8),
});

export const salesReportQuery = z
  .object({ ...rangeShape, ...pageShape, channel: z.enum(ORDER_CHANNELS).optional() })
  .superRefine(checkRange);

export const paymentsReportQuery = z
  .object({ ...rangeShape, ...pageShape, method: z.enum(PAYMENT_METHODS).optional() })
  .superRefine(checkRange);

export const customersReportQuery = z
  .object({ ...rangeShape, ...pageShape, sort: z.enum(CUSTOMER_REPORT_SORTS).default('spent') })
  .superRefine(checkRange);

export const inventoryReportQuery = z.object({
  branch: objectId.optional(),
  ...pageShape,
  stock: z.enum(INVENTORY_STOCK_FILTERS).default('all'),
  q: z.string().trim().max(100).optional(),
});
