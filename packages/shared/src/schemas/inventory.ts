import { z } from 'zod';
import { objectId, optionalText, paginationQuery, queryBoolean, text } from './common';

export const MOVEMENT_TYPES = [
  'stock_in', 'stock_out', 'adjustment', 'transfer_out', 'transfer_in',
  'sale', 'reservation_hold', 'reservation_release', 'return',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const STOCK_OUT_REASONS = ['damaged', 'lost', 'expired', 'returned_to_supplier', 'internal_use', 'other'] as const;
export const ADJUSTMENT_STATUSES = ['pending', 'applied', 'rejected'] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];
export const TRANSFER_STATUSES = ['requested', 'approved', 'rejected', 'in_transit', 'received', 'cancelled'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

const quantity = z.number().int('Whole units only').min(1, 'At least 1').max(100_000);

const lineItem = z.object({
  product: objectId,
  /** Required for products with variants; null otherwise. */
  variantId: objectId.nullable().default(null),
  quantity,
});

function uniqueLines(items: { product: string; variantId: string | null }[]) {
  const keys = items.map((i) => `${i.product}:${i.variantId ?? ''}`);
  return new Set(keys).size === keys.length;
}

export const stockInSchema = z.object({
  branch: objectId,
  items: z.array(lineItem).min(1).max(100).refine(uniqueLines, 'Each product appears once'),
  /** Supplier invoice / delivery note number. */
  reference: optionalText(100),
  note: optionalText(300),
});
export type StockInInput = z.input<typeof stockInSchema>;

export const stockOutSchema = z.object({
  branch: objectId,
  items: z.array(lineItem).min(1).max(100).refine(uniqueLines, 'Each product appears once'),
  reason: z.enum(STOCK_OUT_REASONS),
  note: optionalText(300),
});
export type StockOutInput = z.input<typeof stockOutSchema>;

export const adjustmentSchema = z.object({
  branch: objectId,
  items: z
    .array(
      z.object({
        product: objectId,
        variantId: objectId.nullable().default(null),
        /** Positive adds units (found stock), negative removes them (count shortfall). */
        delta: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, 'Cannot be zero'),
      }),
    )
    .min(1)
    .max(100)
    .refine(uniqueLines, 'Each product appears once'),
  reason: text(300),
});
export type AdjustmentInput = z.input<typeof adjustmentSchema>;

export const reviewSchema = z.object({ note: optionalText(300) });

export const updateInventorySchema = z.object({
  /** Null uses the company default. */
  reorderLevel: z.number().int().min(0).max(100_000).nullable().optional(),
  /** Hide this product at this branch even when in stock. */
  isAvailable: z.boolean().optional(),
});

export const transferSchema = z
  .object({
    fromBranch: objectId,
    toBranch: objectId,
    items: z.array(lineItem).min(1).max(100).refine(uniqueLines, 'Each product appears once'),
    note: optionalText(500),
  })
  .refine((t) => t.fromBranch !== t.toBranch, { message: 'Choose two different branches', path: ['toBranch'] });
export type TransferInput = z.input<typeof transferSchema>;

export const TRANSFER_ACTIONS = ['approve', 'reject', 'dispatch', 'receive', 'cancel'] as const;
export type TransferAction = (typeof TRANSFER_ACTIONS)[number];

export const listInventoryQuery = paginationQuery.extend({
  branch: objectId.optional(),
  product: objectId.optional(),
  lowStock: queryBoolean.optional(),
  outOfStock: queryBoolean.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const listMovementsQuery = paginationQuery.extend({
  branch: objectId.optional(),
  product: objectId.optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const listAdjustmentsQuery = paginationQuery.extend({
  branch: objectId.optional(),
  status: z.enum(ADJUSTMENT_STATUSES).optional(),
});

export const listTransfersQuery = paginationQuery.extend({
  branch: objectId.optional(),
  status: z.enum(TRANSFER_STATUSES).optional(),
});
