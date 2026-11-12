import { ADJUSTMENT_STATUSES, type AdjustmentStatus, MOVEMENT_TYPES, type MovementType, TRANSFER_STATUSES, type TransferStatus } from '@mb/shared';
import { type HydratedDocument, Schema, type Types, model } from 'mongoose';

// ------------------------------------------------------------------ Inventory (one per product variant per branch)

export interface IInventory {
  product: Types.ObjectId;
  variantId: Types.ObjectId | null;
  sku: string;
  branch: Types.ObjectId;
  /** Physically on hand. Never negative. */
  quantity: number;
  /** Held for reservations and unfulfilled orders. Available = quantity − reserved. */
  reserved: number;
  /** Null uses the company default (settings.lowStockDefault). */
  reorderLevel: number | null;
  isAvailable: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const inventorySchema = new Schema<IInventory>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, default: null },
    sku: { type: String, required: true },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    quantity: { type: Number, default: 0, min: 0 },
    reserved: { type: Number, default: 0, min: 0 },
    reorderLevel: { type: Number, default: null },
    isAvailable: { type: Boolean, default: true },
  },
  { timestamps: true },
);
inventorySchema.index({ product: 1, variantId: 1, branch: 1 }, { unique: true });
inventorySchema.index({ branch: 1, sku: 1 });
inventorySchema.index({ branch: 1, updatedAt: -1 });

export const Inventory = model<IInventory>('Inventory', inventorySchema);
export type InventoryDoc = HydratedDocument<IInventory>;

// ------------------------------------------------------------------ Movement ledger (append-only)

export interface IInventoryMovement {
  inventory: Types.ObjectId;
  product: Types.ObjectId;
  variantId: Types.ObjectId | null;
  sku: string;
  branch: Types.ObjectId;
  type: MovementType;
  quantityDelta: number;
  reservedDelta: number;
  /** Quantity on hand after this movement. */
  balanceAfter: number;
  reference?: { kind: string; id: Types.ObjectId; label?: string } | null;
  reason?: string;
  performedBy?: Types.ObjectId | null;
  createdAt: Date;
}

const movementSchema = new Schema<IInventoryMovement>(
  {
    inventory: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, default: null },
    sku: { type: String, required: true },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    quantityDelta: { type: Number, default: 0 },
    reservedDelta: { type: Number, default: 0 },
    balanceAfter: { type: Number, required: true },
    reference: { kind: String, id: Schema.Types.ObjectId, label: String },
    reason: { type: String, maxlength: 300 },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
movementSchema.index({ branch: 1, createdAt: -1 });
movementSchema.index({ createdAt: -1 });
movementSchema.index({ inventory: 1, createdAt: -1 });
movementSchema.index({ product: 1, createdAt: -1 });
movementSchema.index({ 'reference.kind': 1, 'reference.id': 1 });
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  movementSchema.pre(op, function () {
    throw new Error('Inventory movements are append-only');
  });
}

export const InventoryMovement = model<IInventoryMovement>('InventoryMovement', movementSchema);

// ------------------------------------------------------------------ Stock lines shared by adjustments and transfers

interface IStockLine {
  product: Types.ObjectId;
  variantId: Types.ObjectId | null;
  sku: string;
  name: string;
}

const lineFields = {
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, default: null },
  sku: { type: String, required: true },
  name: { type: String, required: true },
};

// ------------------------------------------------------------------ Stock adjustments

export interface IStockAdjustment {
  reference: string;
  branch: Types.ObjectId;
  items: (IStockLine & { delta: number })[];
  reason: string;
  status: AdjustmentStatus;
  requestedBy: Types.ObjectId;
  reviewedBy?: Types.ObjectId | null;
  reviewNote?: string;
  reviewedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const adjustmentSchema = new Schema<IStockAdjustment>(
  {
    reference: { type: String, required: true, unique: true },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    items: [new Schema({ ...lineFields, delta: { type: Number, required: true } }, { _id: false })],
    reason: { type: String, required: true, maxlength: 300 },
    status: { type: String, enum: ADJUSTMENT_STATUSES, default: 'pending' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewNote: { type: String, maxlength: 300 },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);
adjustmentSchema.index({ branch: 1, status: 1, createdAt: -1 });

export const StockAdjustment = model<IStockAdjustment>('StockAdjustment', adjustmentSchema);
export type StockAdjustmentDoc = HydratedDocument<IStockAdjustment>;

// ------------------------------------------------------------------ Stock transfers between branches

export interface IStockTransfer {
  reference: string;
  fromBranch: Types.ObjectId;
  toBranch: Types.ObjectId;
  items: (IStockLine & { quantity: number })[];
  status: TransferStatus;
  note?: string;
  history: { status: TransferStatus; by: Types.ObjectId | null; at: Date; note?: string }[];
  requestedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const transferSchema = new Schema<IStockTransfer>(
  {
    reference: { type: String, required: true, unique: true },
    fromBranch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    toBranch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    items: [new Schema({ ...lineFields, quantity: { type: Number, required: true, min: 1 } }, { _id: false })],
    status: { type: String, enum: TRANSFER_STATUSES, default: 'requested' },
    note: { type: String, maxlength: 500 },
    history: [
      new Schema(
        {
          status: { type: String, enum: TRANSFER_STATUSES, required: true },
          by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          at: { type: Date, required: true },
          note: { type: String, maxlength: 300 },
        },
        { _id: false },
      ),
    ],
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, optimisticConcurrency: true },
);
transferSchema.index({ fromBranch: 1, status: 1, createdAt: -1 });
transferSchema.index({ toBranch: 1, status: 1, createdAt: -1 });

export const StockTransfer = model<IStockTransfer>('StockTransfer', transferSchema);
export type StockTransferDoc = HydratedDocument<IStockTransfer>;
