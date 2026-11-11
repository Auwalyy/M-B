import { FULFILMENT_METHODS, type FulfilmentMethod, ORDER_STATUSES, type OrderStatus, PAYMENT_METHODS, type PaymentMethod, PROMOTION_TYPES, type PromotionType } from '@mb/shared';
import { type HydratedDocument, Schema, type Types, model } from 'mongoose';

// ------------------------------------------------------------------ Promotion

export interface IPromotion {
  name: string;
  code?: string | null;
  description?: string;
  type: PromotionType;
  value: number;
  products: Types.ObjectId[];
  categories: Types.ObjectId[];
  brands: Types.ObjectId[];
  branches: Types.ObjectId[];
  minOrderAmount?: number | null;
  maxDiscount?: number | null;
  startsAt: Date;
  endsAt: Date;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  usedCount: number;
  status: 'active' | 'inactive';
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const promotionSchema = new Schema<IPromotion>(
  {
    name: { type: String, required: true, maxlength: 80 },
    code: { type: String, uppercase: true, trim: true, default: null },
    description: { type: String, maxlength: 300 },
    type: { type: String, enum: PROMOTION_TYPES, required: true },
    value: { type: Number, required: true, min: 0 },
    products: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    categories: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    brands: [{ type: Schema.Types.ObjectId, ref: 'Brand' }],
    branches: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],
    minOrderAmount: { type: Number, default: null },
    maxDiscount: { type: Number, default: null },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    usageLimit: { type: Number, default: null },
    perCustomerLimit: { type: Number, default: null },
    usedCount: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
promotionSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: 'string' } } });
promotionSchema.index({ status: 1, startsAt: 1, endsAt: 1 });

export const Promotion = model<IPromotion>('Promotion', promotionSchema);
export type PromotionDoc = HydratedDocument<IPromotion>;

// ------------------------------------------------------------------ Delivery zone

export interface IDeliveryZone {
  branch: Types.ObjectId;
  name: string;
  areas: string[];
  fee: number;
  freeAbove?: number | null;
  estimatedDays: number;
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}

const zoneSchema = new Schema<IDeliveryZone>(
  {
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    name: { type: String, required: true, maxlength: 80 },
    areas: [{ type: String, maxlength: 80 }],
    fee: { type: Number, required: true, min: 0 },
    freeAbove: { type: Number, default: null },
    estimatedDays: { type: Number, default: 1 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true },
);
zoneSchema.index({ branch: 1, status: 1, name: 1 });

export const DeliveryZone = model<IDeliveryZone>('DeliveryZone', zoneSchema);

// ------------------------------------------------------------------ Cart (one per user, or per guest browser)

export interface ICart {
  user?: Types.ObjectId | null;
  /** SHA-256 of the guest cookie token. */
  guestTokenHash?: string | null;
  branch?: Types.ObjectId | null;
  items: { product: Types.ObjectId; variantId: Types.ObjectId | null; quantity: number; addedAt: Date }[];
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const cartSchema = new Schema<ICart>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    guestTokenHash: { type: String, default: null },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    items: [
      new Schema(
        {
          product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
          variantId: { type: Schema.Types.ObjectId, default: null },
          quantity: { type: Number, required: true, min: 1, max: 100 },
          addedAt: { type: Date, default: () => new Date() },
        },
        { _id: false },
      ),
    ],
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);
cartSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { user: { $type: 'objectId' } } });
cartSchema.index({ guestTokenHash: 1 }, { unique: true, partialFilterExpression: { guestTokenHash: { $type: 'string' } } });
// Guest carts disappear after 30 days of inactivity.
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Cart = model<ICart>('Cart', cartSchema);
export type CartDoc = HydratedDocument<ICart>;

// ------------------------------------------------------------------ Order (items are embedded snapshots: decision D1)

export interface IOrderItem {
  product: Types.ObjectId;
  variantId: Types.ObjectId | null;
  sku: string;
  name: string;
  variantLabel?: string | null;
  slug: string;
  image?: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface IOrder {
  reference: string;
  channel: 'online' | 'in_store' | 'whatsapp' | 'phone';
  customer: Types.ObjectId;
  /** Contact details as given for this order. */
  contact: { fullName: string; phone: string; email?: string | null };
  branch: Types.ObjectId;
  items: IOrderItem[];
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  total: number;
  promotion?: { id: Types.ObjectId; name: string; code?: string | null; discount: number } | null;
  fulfilment: {
    method: FulfilmentMethod;
    zone?: Types.ObjectId | null;
    zoneName?: string | null;
    address?: { line1: string; area?: string | null; city: string; state: string; landmark?: string | null } | null;
  };
  paymentMethod: PaymentMethod;
  paymentStatus: 'unpaid' | 'partially_paid' | 'paid' | 'refunded' | 'partially_refunded';
  amountPaid: number;
  status: OrderStatus;
  statusHistory: { from: OrderStatus | null; to: OrderStatus; by: Types.ObjectId | null; at: Date; note?: string | null }[];
  note?: string | null;
  idempotencyKey?: string | null;
  createdBy?: Types.ObjectId | null;
  user?: Types.ObjectId | null;
  confirmedAt?: Date | null;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<IOrderItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, default: null },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    variantLabel: { type: String, default: null },
    slug: { type: String, required: true },
    image: { type: String, default: null },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    reference: { type: String, required: true, unique: true },
    channel: { type: String, enum: ['online', 'in_store', 'whatsapp', 'phone'], required: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    contact: { fullName: { type: String, required: true }, phone: { type: String, required: true }, email: { type: String, default: null } },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    items: { type: [orderItemSchema], validate: [(v: unknown[]) => v.length > 0, 'An order needs at least one item'] },
    subtotal: { type: Number, required: true, min: 0 },
    discountTotal: { type: Number, default: 0, min: 0 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    promotion: { id: Schema.Types.ObjectId, name: String, code: String, discount: Number },
    fulfilment: {
      method: { type: String, enum: FULFILMENT_METHODS, required: true },
      zone: { type: Schema.Types.ObjectId, ref: 'DeliveryZone', default: null },
      zoneName: { type: String, default: null },
      address: { line1: String, area: String, city: String, state: String, landmark: String },
    },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    paymentStatus: { type: String, enum: ['unpaid', 'partially_paid', 'paid', 'refunded', 'partially_refunded'], default: 'unpaid' },
    amountPaid: { type: Number, default: 0 },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending' },
    statusHistory: [
      new Schema(
        {
          from: { type: String, enum: [...ORDER_STATUSES, null], default: null },
          to: { type: String, enum: ORDER_STATUSES, required: true },
          by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          at: { type: Date, required: true },
          note: { type: String, default: null },
        },
        { _id: false },
      ),
    ],
    note: { type: String, maxlength: 500, default: null },
    idempotencyKey: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
  },
  { timestamps: true, optimisticConcurrency: true },
);
orderSchema.index({ branch: 1, status: 1, createdAt: -1 });
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
orderSchema.index({ 'promotion.id': 1, customer: 1 });

export const Order = model<IOrder>('Order', orderSchema);
export type OrderDoc = HydratedDocument<IOrder>;
