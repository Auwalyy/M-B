import { z } from 'zod';
import { CUSTOMER_SOURCES, NIGERIAN_STATES } from '../enums';
import { email, objectId, optionalText, paginationQuery, phone, text } from './common';

export const addressSchema = z.object({
  label: optionalText(40),
  line1: text(300),
  area: optionalText(120),
  city: text(80),
  state: z.enum(NIGERIAN_STATES),
  landmark: optionalText(200),
  isDefault: z.boolean().default(false),
});

const tag = z.string().trim().toLowerCase().min(1).max(40).regex(/^[a-z0-9][a-z0-9 _-]*$/, 'Letters, numbers, spaces and dashes only');

export const STAFF_CUSTOMER_SOURCES = ['walk_in', 'whatsapp', 'phone'] as const;

export const createCustomerSchema = z.object({
  fullName: text(120),
  phone,
  email: email.optional(),
  /** Branch where the customer is being served (must be in the staff member's scope). */
  branch: objectId,
  preferredBranch: objectId.optional(),
  address: addressSchema.optional(),
  tags: z.array(tag).max(20).default([]),
  notes: optionalText(2000),
  source: z.enum(STAFF_CUSTOMER_SOURCES).default('walk_in'),
});
export type CreateCustomerInput = z.input<typeof createCustomerSchema>;

export const updateCustomerSchema = z.object({
  fullName: text(120).optional(),
  email: email.nullable().optional(),
  preferredBranch: objectId.nullable().optional(),
  tags: z.array(tag).max(20).optional(),
  notes: optionalText(2000),
  addresses: z.array(addressSchema).max(10).optional(),
});
export type UpdateCustomerInput = z.input<typeof updateCustomerSchema>;

export const linkBranchSchema = z.object({ branch: objectId });

export const customerLookupQuery = z.object({ phone });

export const INTERACTION_CHANNELS = ['whatsapp', 'phone', 'email', 'in_store', 'sms', 'system'] as const;
export const interactionSchema = z.object({
  branch: objectId,
  channel: z.enum(INTERACTION_CHANNELS),
  direction: z.enum(['inbound', 'outbound']),
  summary: text(1000),
});
export type InteractionInput = z.input<typeof interactionSchema>;

export const listCustomersQuery = paginationQuery.extend({
  branch: objectId.optional(),
  tag: z.string().trim().toLowerCase().max(40).optional(),
  source: z.enum(CUSTOMER_SOURCES).optional(),
  segment: objectId.optional(),
  sort: z.enum(['recent', 'name', 'top_spenders']).default('recent'),
});

/** A saved customer segment. Every condition is optional; all conditions must match. */
export const segmentFilterSchema = z
  .object({
    minTotalSpent: z.number().int().min(0).optional(),
    maxTotalSpent: z.number().int().min(0).optional(),
    minOrders: z.number().int().min(0).optional(),
    maxOrders: z.number().int().min(0).optional(),
    /** No order in at least this many days (includes customers who never ordered). */
    inactiveDays: z.number().int().min(1).max(3650).optional(),
    /** Registered within the last N days. */
    joinedWithinDays: z.number().int().min(1).max(3650).optional(),
    preferredBranch: objectId.optional(),
    branchServed: objectId.optional(),
    tags: z.array(tag).max(10).optional(),
    source: z.enum(CUSTOMER_SOURCES).optional(),
  })
  .refine((f) => Object.values(f).some((v) => v !== undefined && !(Array.isArray(v) && v.length === 0)), 'Add at least one condition');
export type SegmentFilter = z.output<typeof segmentFilterSchema>;

export const segmentSchema = z.object({
  name: text(80),
  description: optionalText(300),
  filter: segmentFilterSchema,
});
export type SegmentInput = z.input<typeof segmentSchema>;
export const updateSegmentSchema = segmentSchema.partial();

// ---- Enquiries

export const ENQUIRY_CHANNELS = ['web_form', 'whatsapp', 'phone', 'walk_in'] as const;
export type EnquiryChannel = (typeof ENQUIRY_CHANNELS)[number];
export const ENQUIRY_STATUSES = ['new', 'in_progress', 'responded', 'converted', 'closed'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

/** Submitted by visitors through the website. */
export const publicEnquirySchema = z.object({
  branch: objectId,
  name: text(120),
  phone,
  email: email.optional(),
  product: objectId.optional(),
  subject: text(150),
  message: text(2000),
  /** Honeypot: real visitors never fill this hidden field. */
  website: z.string().max(0, 'Spam detected').optional(),
});
export type PublicEnquiryInput = z.input<typeof publicEnquirySchema>;

/** Logged by staff for enquiries that arrived by WhatsApp, phone or in person. */
export const staffEnquirySchema = z.object({
  branch: objectId,
  channel: z.enum(['whatsapp', 'phone', 'walk_in']),
  name: text(120),
  phone,
  email: email.optional(),
  product: objectId.optional(),
  subject: text(150),
  message: text(2000),
});
export type StaffEnquiryInput = z.input<typeof staffEnquirySchema>;

export const updateEnquirySchema = z.object({
  status: z.enum(ENQUIRY_STATUSES).optional(),
  assignedTo: objectId.nullable().optional(),
  note: optionalText(1000),
});

export const listEnquiriesQuery = paginationQuery.extend({
  branch: objectId.optional(),
  status: z.enum(ENQUIRY_STATUSES).optional(),
  channel: z.enum(ENQUIRY_CHANNELS).optional(),
  assignedToMe: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
