import type { PublicSettingsDto, SettingsDto, updateSettingsSchema } from '@mb/shared';
import type { z } from 'zod';
import type { AuthContext } from '../../core/auth/AuthContext';
import { withTransaction } from '../../core/db/transaction';
import type { RequestMeta } from '../../core/http/route';
import { audit, redact } from '../audit/audit.service';
import { COMPANY_SETTINGS_ID, type ISetting, Setting } from './setting.model';

/** Returns the company settings document, creating it with defaults on first use. */
export async function getSettingsDoc() {
  const doc = await Setting.findOneAndUpdate(
    { _id: COMPANY_SETTINGS_ID },
    { $setOnInsert: { _id: COMPANY_SETTINGS_ID } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  return doc!;
}

export function toPublicSettings(s: ISetting): PublicSettingsDto {
  return {
    companyName: s.companyName,
    tagline: s.tagline ?? null,
    supportEmail: s.supportEmail,
    supportPhone: s.supportPhone,
    whatsapp: s.whatsapp,
    address: s.address ?? null,
    logoUrl: s.logoUrl ?? null,
    guestCheckoutEnabled: s.guestCheckoutEnabled,
    pricesIncludeVat: s.pricesIncludeVat,
  };
}

export function toSettingsDto(s: ISetting): SettingsDto {
  return {
    ...toPublicSettings(s),
    lowStockDefault: s.lowStockDefault,
    adjustmentApprovalThreshold: s.adjustmentApprovalThreshold,
    pendingOrderExpiryHours: s.pendingOrderExpiryHours,
    bankTransfer: s.bankTransfer?.accountNumber ? { bankName: s.bankTransfer.bankName, accountName: s.bankTransfer.accountName, accountNumber: s.bankTransfer.accountNumber } : null,
    reservation: {
      pendingExpiryHours: s.reservation.pendingExpiryHours,
      confirmedHoldHours: s.reservation.confirmedHoldHours,
      maxQuantityPerItem: s.reservation.maxQuantityPerItem,
    },
    showVatOnReceipts: s.showVatOnReceipts,
    vatRatePercent: s.vatRatePercent,
    receiptFooter: s.receiptFooter ?? null,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function updateSettings(
  input: z.output<typeof updateSettingsSchema>,
  auth: AuthContext,
  meta: RequestMeta,
): Promise<SettingsDto> {
  return withTransaction(async () => {
    const doc = await getSettingsDoc();
    const before = redact(toSettingsDto(doc));
    const { reservation, ...rest } = input;
    doc.set(rest);
    if (reservation) doc.set('reservation', { ...doc.toObject().reservation, ...reservation });
    doc.set('updatedBy', auth.userId);
    await doc.save();
    const dto = toSettingsDto(doc);
    await audit({ action: 'settings.updated', actor: auth, entity: { kind: 'Setting', label: 'Company settings' }, before, after: dto }, meta);
    return dto;
  });
}
