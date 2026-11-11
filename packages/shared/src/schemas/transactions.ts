import { z } from 'zod';
import { DELIVERY_STATUSES, FULFILMENT_METHODS, ORDER_STATUSES, RESERVATION_STATUSES } from '../enums';
import { email, objectId, optionalText, paginationQuery, phone, text } from './common';
import { kobo } from './catalog';
import { deliveryAddressSchema } from './commerce';

const lines = z
  .array(z.object({ product: objectId, variantId: objectId.nullable().default(null), quantity: z.number().int().min(1).max(100) }))
  .min(1)
  .max(30)
  .refine((items) => new Set(items.map((i) => `${i.product}:${i.variantId ?? ''}`)).size === items.length, 'Each product appears once');

const contact = z.object({ fullName: text(120), phone, email: email.optional() });

// ------------------------------------------------------------------ reservations

export const createReservationSchema = z.object({
  branch: objectId,
  items: lines,
  contact,
  note: optionalText(500),
  /** Website honeypot. */
  website: z.string().max(0).optional(),
});
export type CreateReservationInput = z.input<typeof createReservationSchema>;

/** Staff create reservations for walk-in, phone or WhatsApp customers; they are confirmed at once. */
export const staffReservationSchema = createReservationSchema.omit({ website: true }).extend({
  channel: z.enum(['in_store', 'phone', 'whatsapp']).default('in_store'),
  enquiry: objectId.optional(),
});

export const rejectSchema = z.object({ reason: text(300) });
export const noteSchema = z.object({ note: optionalText(300) });

export const listReservationsQuery = paginationQuery.extend({
  branch: objectId.optional(),
  status: z.enum(RESERVATION_STATUSES).optional(),
});

export const trackReservationQuery = z.object({
  reference: z.string().trim().toUpperCase().regex(/^RSV-[A-Z]{3}\d{2}-\d{6,}$/, 'Check the reservation number'),
  phone,
});

/** Turn a reservation into an order. */
export const convertReservationSchema = z.object({
  fulfilment: z.enum(FULFILMENT_METHODS).default('pickup'),
  paymentMethod: z.enum(['cash', 'pos', 'bank_transfer', 'pay_on_pickup', 'pay_on_delivery']).default('pay_on_pickup'),
  deliveryZone: objectId.optional(),
  deliveryAddress: deliveryAddressSchema.optional(),
});

// ------------------------------------------------------------------ staff orders and order workflow

export const STAFF_PAYMENT_METHODS = ['cash', 'pos', 'bank_transfer', 'pay_on_pickup', 'pay_on_delivery'] as const;

export const staffOrderSchema = z
  .object({
    branch: objectId,
    channel: z.enum(['in_store', 'phone', 'whatsapp']),
    /** An existing customer, or contact details (the central record is found or created by phone). */
    customer: objectId.optional(),
    contact: contact.optional(),
    items: lines,
    fulfilment: z.enum(FULFILMENT_METHODS),
    deliveryZone: objectId.optional(),
    deliveryAddress: deliveryAddressSchema.optional(),
    paymentMethod: z.enum(STAFF_PAYMENT_METHODS),
    promoCode: z.string().trim().toUpperCase().max(20).optional().transform((v) => v || undefined),
    note: optionalText(500),
    enquiry: objectId.optional(),
    idempotencyKey: z.string().trim().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/),
  })
  .superRefine((o, ctx) => {
    if (!o.customer && !o.contact) ctx.addIssue({ code: 'custom', path: ['contact'], message: 'Choose a customer or enter their details' });
    if (o.fulfilment === 'delivery' && (!o.deliveryZone || !o.deliveryAddress)) ctx.addIssue({ code: 'custom', path: ['deliveryAddress'], message: 'Delivery needs an area and an address' });
  });
export type StaffOrderInput = z.input<typeof staffOrderSchema>;

export const orderStatusSchema = z.object({
  to: z.enum(ORDER_STATUSES),
  note: optionalText(300),
});

// ------------------------------------------------------------------ payments

export const MANUAL_PAYMENT_METHODS = ['cash', 'pos', 'bank_transfer'] as const;
export const recordPaymentSchema = z.object({
  order: objectId,
  method: z.enum(MANUAL_PAYMENT_METHODS),
  amount: kobo.min(1, 'Enter the amount received'),
  /** Bank transfer reference or POS slip number. */
  providerReference: optionalText(100),
  note: optionalText(300),
});
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;

export const refundSchema = z.object({
  amount: kobo.min(1),
  reason: text(300),
  /** Put the returned items back into stock (completed orders). */
  restock: z.boolean().default(false),
});

export const paystackInitSchema = z.object({
  order: z.string().trim().toUpperCase().regex(/^ORD-[A-Z]{3}\d{2}-\d{6,}$/),
  /** Guests prove ownership with the phone used at checkout. */
  phone: phone.optional(),
});

export const listPaymentsQuery = paginationQuery.extend({
  branch: objectId.optional(),
  status: z.enum(['pending', 'success', 'failed', 'abandoned', 'reversed']).optional(),
  method: z.enum(['paystack', 'bank_transfer', 'cash', 'pos']).optional(),
});

// ------------------------------------------------------------------ deliveries

export const assignDeliverySchema = z.object({
  /** A staff member, or an outside rider by name and phone. */
  user: objectId.optional(),
  name: text(120),
  phone,
});
export const deliveryStatusSchema = z.object({ status: z.enum(DELIVERY_STATUSES), note: optionalText(300) });
export const listDeliveriesQuery = paginationQuery.extend({
  branch: objectId.optional(),
  status: z.enum(DELIVERY_STATUSES).optional(),
});

// ------------------------------------------------------------------ notifications and WhatsApp

export const listNotificationsQuery = paginationQuery.extend({ unread: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });

export const WHATSAPP_CONTEXTS = ['product', 'order', 'reservation', 'branch'] as const;
export const whatsappClickSchema = z.object({
  context: z.enum(WHATSAPP_CONTEXTS),
  ref: z.string().trim().max(100).optional(),
  branch: objectId.optional(),
});
