import { Schema, model } from 'mongoose';

export const COMPANY_SETTINGS_ID = 'company';

export interface ISetting {
  _id: string;
  companyName: string;
  tagline?: string;
  supportEmail: string;
  supportPhone: string;
  whatsapp: string;
  address?: string;
  logoUrl?: string;
  lowStockDefault: number;
  adjustmentApprovalThreshold: number;
  reservation: { pendingExpiryHours: number; confirmedHoldHours: number; maxQuantityPerItem: number };
  guestCheckoutEnabled: boolean;
  pricesIncludeVat: boolean;
  showVatOnReceipts: boolean;
  vatRatePercent: number;
  receiptFooter?: string;
  updatedBy?: Schema.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const settingSchema = new Schema<ISetting>(
  {
    _id: { type: String, default: COMPANY_SETTINGS_ID },
    companyName: { type: String, default: 'Mudassir & Brothers' },
    tagline: { type: String, default: 'Quality products across Kano and Abuja' },
    supportEmail: { type: String, default: 'support@mudassirbrothers.com' },
    supportPhone: { type: String, default: '+2348000000000' },
    whatsapp: { type: String, default: '+2348000000000' },
    address: String,
    logoUrl: String,
    lowStockDefault: { type: Number, default: 5, min: 0 },
    adjustmentApprovalThreshold: { type: Number, default: 10, min: 0 },
    reservation: {
      pendingExpiryHours: { type: Number, default: 24 },
      confirmedHoldHours: { type: Number, default: 48 },
      maxQuantityPerItem: { type: Number, default: 10 },
    },
    guestCheckoutEnabled: { type: Boolean, default: true },
    pricesIncludeVat: { type: Boolean, default: true },
    showVatOnReceipts: { type: Boolean, default: false },
    vatRatePercent: { type: Number, default: 7.5 },
    receiptFooter: { type: String, default: 'Thank you for shopping with Mudassir & Brothers.' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const Setting = model<ISetting>('Setting', settingSchema);
