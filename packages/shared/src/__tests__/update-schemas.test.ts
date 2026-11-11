import { describe, expect, it } from 'vitest';
import {
  updateBranchSchema,
  updateBrandSchema,
  updateCategorySchema,
  updateCustomerSchema,
  updateDeliveryZoneSchema,
  updatePromotionSchema,
  updateProductSchema,
  updateSettingsSchema,
  updateStaffSchema,
} from '../index';

/**
 * Zod 4 applies .default() even inside .partial(). An update schema that produced values from
 * an empty body would silently reset fields the user never touched, so every one must stay empty.
 */
describe('partial update schemas never invent values', () => {
  it.each([
    ['product', updateProductSchema],
    ['category', updateCategorySchema],
    ['brand', updateBrandSchema],
    ['branch', updateBranchSchema],
    ['settings', updateSettingsSchema],
    ['staff', updateStaffSchema],
    ['customer', updateCustomerSchema],
    ['promotion', updatePromotionSchema],
    ['delivery zone', updateDeliveryZoneSchema],
  ] as const)('%s', (_name, schema) => {
    const out = (schema as { parse: (v: unknown) => Record<string, unknown> }).parse({});
    expect(Object.values(out).filter((v) => v !== undefined)).toEqual([]);
  });
});
