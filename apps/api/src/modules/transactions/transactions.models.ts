import { DELIVERY_STATUSES, type DeliveryStatus, PAYMENT_METHODS, PAYMENT_STATUSES, type PaymentMethod, type PaymentStatus, RESERVATION_STATUSES, type ReservationStatus } from '@mb/shared';
import { type HydratedDocument, Schema, type Types, model } from 'mongoose';

// ------------------------------------------------------------------ Reservation

export interface IReservation {
  reference: string;
  channel: 'online' | 'in_store' | 'phone' | 'whatsapp';
  customer: Types.ObjectId;
  contact: { fullName: string; phone: string; email?: string | null };
  branch: Types.ObjectId;
  items: { product: Types.ObjectId; variantId: Types.ObjectId | null; sku: string; name: string; variantLabel?: string | null; slug: string; image?: string | null; quantity: number; unitPrice: number }[];
  total: number;
  status: ReservationStatus;
  history: { status: ReservationStatus; by: Types.ObjectId | null; at: Date; note?: string | null }[];
  expiresAt: Date | null;
  note?: string | null;
  rejectionReason?: string | null;
  convertedOrder?: Types.ObjectId | null;
  user?: Types.ObjectId | null;
  createdBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const reservationSchema = new Schema<IReservation>(
  {
    reference: { type: String, required: true, unique: true },
    channel: { type: String, enum: ['online', 'in_store', 'phone', 'whatsapp'], required: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    contact: { fullName: { type: String, required: true }, phone: { type: String, required: true }, email: { type: String, default: null } },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    items: [
      new Schema(
        {
          product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
          variantId: { type: Schema.Types.ObjectId, default: null },
          sku: { type: String, required: true },
          name: { type: String, required: true },
          variantLabel: { type: String, default: null },
          slug: { type: String, required: true },
          image: { type: String, default: null },
          quantity: { type: Number, required: true, min: 1 },
          unitPrice: { type: Number, required: true, min: 0 },
        },
        { _id: false },
      ),
    ],
    total: { type: Number, required: true },
    status: { type: String, enum: RESERVATION_STATUSES, default: 'pending' },
    history: [new Schema({ status: { type: String, enum: RESERVATION_STATUSES, required: true }, by: { type: Schema.Types.ObjectId, ref: 'User', default: null }, at: { type: Date, required: true }, note: { type: String, default: null } }, { _id: false })],
    expiresAt: { type: Date, default: null },
    note: { type: String, maxlength: 500, default: null },
    rejectionReason: { type: String, default: null },
    convertedOrder: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);
reservationSchema.index({ branch: 1, status: 1, createdAt: -1 });
reservationSchema.index({ status: 1, expiresAt: 1 });
reservationSchema.index({ customer: 1, createdAt: -1 });

export const Reservation = model<IReservation>('Reservation', reservationSchema);
export type ReservationDoc = HydratedDocument<IReservation>;

// ------------------------------------------------------------------ Payment

export interface IRefund {
  amount: number;
  reason: string;
  status: 'pending' | 'processed' | 'failed';
  providerRefundId?: string | null;
  restock: boolean;
  by: Types.ObjectId | null;
  at: Date;
}

export interface IPayment {
  reference: string;
  order: Types.ObjectId;
  branch: Types.ObjectId;
  customer: Types.ObjectId;
  method: PaymentMethod;
  amount: number;
  status: PaymentStatus;
  provider?: { name: 'paystack'; transactionId?: string | null; channel?: string | null; paidAt?: Date | null; authorizationUrl?: string | null; raw?: unknown } | null;
  providerReference?: string | null;
  receiptNumber?: string | null;
  refunds: IRefund[];
  recordedBy?: Types.ObjectId | null;
  /** 'webhook', 'verify_api' or 'staff' */
  verifiedBy?: string | null;
  verifiedByUser?: Types.ObjectId | null;
  verifiedAt?: Date | null;
  note?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    reference: { type: String, required: true, unique: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
    provider: { name: String, transactionId: String, channel: String, paidAt: Date, authorizationUrl: String, raw: Schema.Types.Mixed },
    providerReference: { type: String, default: null },
    receiptNumber: { type: String, default: null },
    refunds: [
      new Schema<IRefund>(
        {
          amount: { type: Number, required: true, min: 1 },
          reason: { type: String, required: true },
          status: { type: String, enum: ['pending', 'processed', 'failed'], required: true },
          providerRefundId: { type: String, default: null },
          restock: { type: Boolean, default: false },
          by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          at: { type: Date, required: true },
        },
        { _id: true },
      ),
    ],
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedBy: { type: String, default: null },
    verifiedByUser: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },
    note: { type: String, maxlength: 300, default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);
paymentSchema.index({ order: 1 });
paymentSchema.index({ branch: 1, verifiedAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });
// Reports: collected revenue by verification date, refunds by refund date.
paymentSchema.index({ status: 1, verifiedAt: -1 });
paymentSchema.index({ 'refunds.at': 1 });
paymentSchema.index({ receiptNumber: 1 }, { unique: true, partialFilterExpression: { receiptNumber: { $type: 'string' } } });

export const Payment = model<IPayment>('Payment', paymentSchema);
export type PaymentDoc = HydratedDocument<IPayment>;

/** Processed provider events, for idempotency and replay protection. */
export interface IWebhookEvent {
  provider: string;
  eventKey: string;
  event: string;
  payload: unknown;
  processedAt?: Date | null;
  createdAt: Date;
}
const webhookSchema = new Schema<IWebhookEvent>(
  { provider: { type: String, required: true }, eventKey: { type: String, required: true }, event: { type: String, required: true }, payload: Schema.Types.Mixed, processedAt: Date },
  { timestamps: { createdAt: true, updatedAt: false } },
);
webhookSchema.index({ provider: 1, eventKey: 1 }, { unique: true });
export const WebhookEvent = model<IWebhookEvent>('WebhookEvent', webhookSchema);

// ------------------------------------------------------------------ Delivery

export interface IDelivery {
  order: Types.ObjectId;
  branch: Types.ObjectId;
  address: { line1: string; area?: string | null; city: string; state: string; landmark?: string | null };
  contact: { fullName: string; phone: string };
  zoneName?: string | null;
  fee: number;
  status: DeliveryStatus;
  assignedTo?: { user?: Types.ObjectId | null; name: string; phone: string } | null;
  history: { status: DeliveryStatus; by: Types.ObjectId | null; at: Date; note?: string | null }[];
  createdAt: Date;
  updatedAt: Date;
}

const deliverySchema = new Schema<IDelivery>(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    address: { line1: { type: String, required: true }, area: String, city: { type: String, required: true }, state: { type: String, required: true }, landmark: String },
    contact: { fullName: { type: String, required: true }, phone: { type: String, required: true } },
    zoneName: { type: String, default: null },
    fee: { type: Number, default: 0 },
    status: { type: String, enum: DELIVERY_STATUSES, default: 'pending' },
    assignedTo: { user: { type: Schema.Types.ObjectId, ref: 'User', default: null }, name: String, phone: String },
    history: [new Schema({ status: { type: String, enum: DELIVERY_STATUSES, required: true }, by: { type: Schema.Types.ObjectId, ref: 'User', default: null }, at: { type: Date, required: true }, note: { type: String, default: null } }, { _id: false })],
  },
  { timestamps: true, optimisticConcurrency: true },
);
deliverySchema.index({ branch: 1, status: 1, updatedAt: -1 });
export const Delivery = model<IDelivery>('Delivery', deliverySchema);
export type DeliveryDoc = HydratedDocument<IDelivery>;
