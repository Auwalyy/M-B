import { z } from 'zod';
import { email, optionalText, password, phone, text } from './common';

export const registerSchema = z.object({
  fullName: text(120),
  phone,
  email: email.optional(),
  password,
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  /** Email address or phone number. */
  identifier: z.string().trim().min(3, 'Enter your email or phone number').max(254),
  password: z.string().min(1, 'Enter your password').max(128),
});
export type LoginInput = z.input<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password,
});
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(128),
    newPassword: password,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must be different from the current one',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

export const updateProfileSchema = z.object({
  fullName: text(120).optional(),
  email: email.optional(),
  phone: phone.optional(),
  avatarUrl: optionalText(500),
});
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;
