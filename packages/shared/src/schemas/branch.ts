import { z } from 'zod';
import { BRANCH_STATUSES, NIGERIAN_STATES } from '../enums';
import { email, objectId, optionalText, paginationQuery, phone, text } from './common';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, e.g. 08:30');

export const openingHoursSchema = z
  .array(
    z
      .object({
        day: z.number().int().min(0).max(6),
        open: time,
        close: time,
        closed: z.boolean().default(false),
      })
      .refine((d) => d.closed || d.open < d.close, {
        message: 'Closing time must be after opening time',
        path: ['close'],
      }),
  )
  .max(7)
  .refine((days) => new Set(days.map((d) => d.day)).size === days.length, 'Each day may appear only once');
export type OpeningHours = z.infer<typeof openingHoursSchema>;

export const branchSettingsSchema = z.object({
  reservationsEnabled: z.boolean(),
  pickupEnabled: z.boolean(),
  deliveryEnabled: z.boolean(),
  /** Overrides the company reservation hold time when set. */
  reservationHoldHours: z.number().int().min(1).max(24 * 14).nullable(),
});

const branchFields = {
  name: text(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}\d{2}$/, 'Use 3 letters and 2 digits, e.g. KAN01'),
  address: text(300),
  area: optionalText(120),
  landmark: optionalText(200),
  city: text(80),
  state: z.enum(NIGERIAN_STATES),
  phone,
  whatsapp: phone,
  email: email.optional(),
  coordinates: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
  openingHours: openingHoursSchema.optional(),
  settings: branchSettingsSchema.partial().optional(),
};

export const createBranchSchema = z.object(branchFields);
export type CreateBranchInput = z.input<typeof createBranchSchema>;

export const updateBranchSchema = z.object(branchFields).partial();
export type UpdateBranchInput = z.input<typeof updateBranchSchema>;

/** Fields a branch administrator may change on their own branch. */
export const BRANCH_PROFILE_FIELDS = [
  'phone', 'whatsapp', 'email', 'openingHours', 'settings', 'landmark', 'area',
] as const;

export const listBranchesQuery = paginationQuery.extend({
  status: z.enum(BRANCH_STATUSES).optional(),
  state: z.enum(NIGERIAN_STATES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

export const branchIdOrCodeParams = z.object({
  idOrCode: z.union([objectId, z.string().trim().toUpperCase().regex(/^[A-Z]{3}\d{2}$/)]),
});
