import { z } from 'zod';
import { FULFILMENT_METHODS, NIGERIAN_STATES, ORDER_STATUSES } from '../enums';
import { email, objectId, optionalText, paginationQuery, phone, text } from './common';
import { kobo } from './catalog';

// ------------------------------------------------------------------ promotions

export const PROMOTION_TYPES = ['percentage', 'fixed_amount', 'free_delivery'] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

const promotionFields = {
  name: text(80),
  /** Customers enter this at checkout. Without a code the promotion applies automatically. */
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,20}$/, 'Use 3–20 letters and digits').nullable().optional(),
  description: optionalText(300),
  type: z.enum(PROMOTION_TYPES),
  /** Percent (1–90) for percentage; kobo for fixed_amount; ignored for free_delivery. */
  value: z.number().int().min(0).max(1_000_000_000_00),
  products: z.array(objectId).max(200),
  categories: z.array(objectId).max(50),
  brands: z.array(objectId).max(50),
  branches: z.array(objectId).max(50),
  minOrderAmount: kobo.nullable().optional(),
  maxDiscount: kobo.nullable().optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  usageLimit: z.number().int().min(1).nullable().optional(),
  perCustomerLimit: z.number().int().min(1).nullable().optional(),
  status: z.enum(['active', 'inactive']),
};

function promotionRules(p: { type?: string; value?: number; startsAt?: Date; endsAt?: Date }, ctx: z.RefinementCtx) {
  if (p.type === 'percentage' && p.value !== undefined && (p.value < 1 || p.value > 90)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Use a percentage between 1 and 90' });
  if (p.type === 'fixed_amount' && p.value !== undefined && p.value < 100) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter an amount of at least ₦1' });
  if (p.startsAt && p.endsAt && p.endsAt <= p.startsAt) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End must be after the start' });
}

export const promotionSchema = z
  .object({
    ...promotionFields,
    products: promotionFields.products.default([]),
    categories: promotionFields.categories.default([]),
    brands: promotionFields.brands.default([]),
    branches: promotionFields.branches.default([]),
    status: promotionFields.status.default('active'),
  })
  .superRefine(promotionRules);
export type PromotionInput = z.input<typeof promotionSchema>;
export const updatePromotionSchema = z.object(promotionFields).partial().superRefine(promotionRules);

// ------------------------------------------------------------------ delivery zones

const zoneFields = {
  branch: objectId,
  name: text(80),
  /** Neighbourhoods covered, shown to customers. */
  areas: z.array(text(80)).max(100),
  fee: kobo,
  /** Free delivery for orders at or above this subtotal. */
  freeAbove: kobo.nullable().optional(),
  estimatedDays: z.number().int().min(0).max(30),
  status: z.enum(['active', 'inactive']),
};
export const deliveryZoneSchema = z.object({
  ...zoneFields,
  areas: zoneFields.areas.default([]),
  estimatedDays: zoneFields.estimatedDays.default(1),
  status: zoneFields.status.default('active'),
});
export type DeliveryZoneInput = z.input<typeof deliveryZoneSchema>;
export const updateDeliveryZoneSchema = z.object(zoneFields).omit({ branch: true }).partial();
export const listZonesQuery = z.object({ branch: objectId.optional() });

// ------------------------------------------------------------------ cart

export const cartItemSchema = z.object({
  product: objectId,
  variantId: objectId.nullable().default(null),
  /** New quantity; 0 removes the line. */
  quantity: z.number().int().min(0).max(100),
});
export const cartBranchSchema = z.object({ branch: objectId });

// ------------------------------------------------------------------ checkout

export const CHECKOUT_PAYMENT_METHODS = ['pay_on_pickup', 'pay_on_delivery', 'bank_transfer', 'paystack'] as const;
export type CheckoutPaymentMethod = (typeof CHECKOUT_PAYMENT_METHODS)[number];

export const deliveryAddressSchema = z.object({
  line1: text(300),
  area: optionalText(120),
  city: text(80),
  state: z.enum(NIGERIAN_STATES),
  landmark: optionalText(200),
});

export const quoteSchema = z.object({
  fulfilment: z.enum(FULFILMENT_METHODS),
  deliveryZone: objectId.optional(),
  promoCode: z.string().trim().toUpperCase().max(20).optional().transform((v) => v || undefined),
});
export type QuoteInput = z.input<typeof quoteSchema>;

export const checkoutSchema = quoteSchema
  .extend({
    contact: z.object({ fullName: text(120), phone, email: email.optional() }),
    deliveryAddress: deliveryAddressSchema.optional(),
    paymentMethod: z.enum(CHECKOUT_PAYMENT_METHODS),
    note: optionalText(500),
    /** Random key from the client, so a retried submit cannot create a second order. */
    idempotencyKey: z.string().trim().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/),
  })
  .superRefine((c, ctx) => {
    if (c.fulfilment === 'delivery') {
      if (!c.deliveryZone) ctx.addIssue({ code: 'custom', path: ['deliveryZone'], message: 'Choose your delivery area' });
      if (!c.deliveryAddress) ctx.addIssue({ code: 'custom', path: ['deliveryAddress'], message: 'Enter the delivery address' });
      if (c.paymentMethod === 'pay_on_pickup') ctx.addIssue({ code: 'custom', path: ['paymentMethod'], message: 'Choose pay on delivery or bank transfer' });
    } else if (c.paymentMethod === 'pay_on_delivery') {
      ctx.addIssue({ code: 'custom', path: ['paymentMethod'], message: 'Choose pay at pickup or bank transfer' });
    }
  });
export type CheckoutInput = z.input<typeof checkoutSchema>;

// ------------------------------------------------------------------ orders

export const trackOrderQuery = z.object({ reference: z.string().trim().toUpperCase().regex(/^ORD-[A-Z]{3}\d{2}-\d{6,}$/, 'Check the order number'), phone });

export const listOrdersQuery = paginationQuery.extend({
  branch: objectId.optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  channel: z.enum(['online', 'in_store', 'whatsapp', 'phone']).optional(),
});

export const cancelOrderSchema = z.object({ reason: optionalText(300) });
