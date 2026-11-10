import { z } from 'zod';
import { STAFF_ROLE_KEYS, USER_STATUSES } from '../enums';
import { ALL_PERMISSIONS } from '../permissions';
import { email, objectId, paginationQuery, password, phone, text } from './common';

export const createStaffSchema = z.object({
  fullName: text(120),
  email: email.optional(),
  phone,
  role: z.enum(STAFF_ROLE_KEYS),
  branches: z.array(objectId).max(50).default([]),
  /** Temporary password; the user must change it at first sign-in. */
  temporaryPassword: password,
});
export type CreateStaffInput = z.input<typeof createStaffSchema>;

export const updateStaffSchema = z.object({
  fullName: text(120).optional(),
  email: email.optional(),
  phone: phone.optional(),
  role: z.enum(STAFF_ROLE_KEYS).optional(),
  /** Needs the users:assign-branches permission. Lets a role change and branch assignment happen together. */
  branches: z.array(objectId).max(50).optional(),
});
export type UpdateStaffInput = z.input<typeof updateStaffSchema>;

export const assignBranchesSchema = z.object({
  branches: z.array(objectId).max(50),
});

export const adminResetPasswordSchema = z.object({ temporaryPassword: password });

export const branchAccessGrantSchema = z.object({
  branch: objectId,
  permissions: z.array(z.enum(ALL_PERMISSIONS)).min(1),
  expiresAt: z.coerce.date().refine((d) => d.getTime() > Date.now(), 'Expiry must be in the future'),
  reason: text(300),
});
export type BranchAccessGrantInput = z.input<typeof branchAccessGrantSchema>;

export const listUsersQuery = paginationQuery.extend({
  role: z.enum(STAFF_ROLE_KEYS).optional(),
  status: z.enum(USER_STATUSES).optional(),
  branch: objectId.optional(),
});

export const updateRoleSchema = z.object({
  name: text(80).optional(),
  description: text(300).optional(),
  permissions: z.array(z.enum(ALL_PERMISSIONS)).optional(),
});
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;
