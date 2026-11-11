import { CUSTOMER_SOURCES, type CustomerSource } from '@mb/shared';
import { type HydratedDocument, Schema, type Types, model } from 'mongoose';

/**
 * Central customer identity, shared by every branch. The full CRM features
 * (interactions, segments, history views) are built in Phase 2; this is the core
 * record that registration and later modules depend on.
 */
export interface ICustomerAddress {
  _id: Types.ObjectId;
  label?: string;
  line1: string;
  area?: string;
  city: string;
  state: string;
  landmark?: string;
  isDefault: boolean;
}

export interface ICustomer {
  fullName: string;
  /** E.164; unique so the same person is recognised across branches. */
  phone: string;
  email?: string;
  addresses: Types.DocumentArray<ICustomerAddress>;
  user?: Types.ObjectId;
  preferredBranch?: Types.ObjectId;
  /** Branches that have served this customer. Controls which branch staff can see them. */
  branchesServed: Types.ObjectId[];
  source: CustomerSource;
  registeredBy?: Types.ObjectId;
  registeredAtBranch?: Types.ObjectId;
  tags: string[];
  notes?: string;
  stats: { orderCount: number; totalSpent: number; lastOrderAt?: Date; reservationCount: number };
  createdAt: Date;
  updatedAt: Date;
}

const addressSchema = new Schema<ICustomerAddress>({
  label: { type: String, maxlength: 40 },
  line1: { type: String, required: true, maxlength: 300 },
  area: { type: String, maxlength: 120 },
  city: { type: String, required: true, maxlength: 80 },
  state: { type: String, required: true, maxlength: 40 },
  landmark: { type: String, maxlength: 200 },
  isDefault: { type: Boolean, default: false },
});

const customerSchema = new Schema<ICustomer>(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, unique: true },
    email: { type: String, trim: true, lowercase: true },
    addresses: [addressSchema],
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    preferredBranch: { type: Schema.Types.ObjectId, ref: 'Branch' },
    branchesServed: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],
    source: { type: String, enum: CUSTOMER_SOURCES, default: 'online' },
    registeredBy: { type: Schema.Types.ObjectId, ref: 'User' },
    registeredAtBranch: { type: Schema.Types.ObjectId, ref: 'Branch' },
    tags: [{ type: String, trim: true, lowercase: true, maxlength: 40 }],
    notes: { type: String, maxlength: 2000 },
    stats: {
      orderCount: { type: Number, default: 0 },
      totalSpent: { type: Number, default: 0 },
      lastOrderAt: Date,
      reservationCount: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

customerSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
customerSchema.index({ branchesServed: 1, createdAt: 1 });
customerSchema.index({ createdAt: 1 });
customerSchema.index({ preferredBranch: 1 });
customerSchema.index({ 'stats.totalSpent': -1 });
customerSchema.index({ fullName: 'text', phone: 'text', email: 'text' });

export const Customer = model<ICustomer>('Customer', customerSchema);
export type CustomerDoc = HydratedDocument<ICustomer>;
