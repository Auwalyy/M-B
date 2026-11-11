import { z } from 'zod';
import { email, optionalText, phone, text } from './common';

export const updateSettingsSchema = z
  .object({
    companyName: text(120),
    tagline: optionalText(200),
    supportEmail: email,
    supportPhone: phone,
    whatsapp: phone,
    address: optionalText(300),
    logoUrl: optionalText(500),
    lowStockDefault: z.number().int().min(0).max(100000),
    /** Stock adjustments larger than this many units (per line) need a second person to approve. */
    adjustmentApprovalThreshold: z.number().int().min(0).max(100000),
    reservation: z.object({
      pendingExpiryHours: z.number().int().min(1).max(24 * 7),
      confirmedHoldHours: z.number().int().min(1).max(24 * 14),
      maxQuantityPerItem: z.number().int().min(1).max(1000),
    }).partial(),
    guestCheckoutEnabled: z.boolean(),
    /** Online orders the branch never confirms are cancelled after this many hours (releasing the stock). */
    pendingOrderExpiryHours: z.number().int().min(1).max(24 * 14),
    /** Shown to customers who choose bank transfer. */
    bankTransfer: z.object({ bankName: text(80), accountName: text(120), accountNumber: z.string().trim().regex(/^\d{10}$/,'Use the 10-digit NUBAN account number') }).nullable(),
    pricesIncludeVat: z.boolean(),
    showVatOnReceipts: z.boolean(),
    vatRatePercent: z.number().min(0).max(100),
    receiptFooter: optionalText(500),
  })
  .partial();
export type UpdateSettingsInput = z.input<typeof updateSettingsSchema>;
