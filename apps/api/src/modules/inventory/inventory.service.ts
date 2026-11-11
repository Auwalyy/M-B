import {
  type AdjustmentDto,
  type InventoryDto,
  type MovementDto,
  type MovementType,
  PERMISSIONS,
  type Permission,
  type TransferAction,
  type TransferDto,
  type TransferStatus,
  type adjustmentSchema,
  type listAdjustmentsQuery,
  type listInventoryQuery,
  type listMovementsQuery,
  type listTransfersQuery,
  type stockInSchema,
  type stockOutSchema,
  type transferSchema,
  type updateInventorySchema,
} from '@mb/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { env } from '../../config/env';
import type { AuthContext } from '../../core/auth/AuthContext';
import { nextReference } from '../../core/db/counter';
import { withTransaction } from '../../core/db/transaction';
import { enqueue, registerOutboxHandler } from '../../core/events/outbox';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../core/errors/AppError';
import { Page, escapeRegex, skipFor } from '../../core/http/pagination';
import type { RequestMeta } from '../../core/http/route';
import { sendMailNow } from '../../core/mail/mailer';
import { lowStockEmail } from '../../core/mail/templates';
import { audit } from '../audit/audit.service';
import { Branch } from '../branches/branch.model';
import { type IImage, type IVariant, Product, variantLabel } from '../catalog/catalog.models';
import { productRef, resolveStockItem, stockLevel } from '../catalog/catalog.service';
import { getSettingsDoc } from '../settings/settings.service';
import { User } from '../users/user.model';
import { notifyBranchTeam, notifyHeadOffice, notifyUsers } from '../notifications/notification.service';
import {
  type IInventory,
  Inventory,
  InventoryMovement,
  type StockAdjustmentDoc,
  StockAdjustment,
  type StockTransferDoc,
  StockTransfer,
} from './inventory.models';

const P = PERMISSIONS;

// ------------------------------------------------------------------ the single entry point for stock changes

export interface StockChange {
  branch: Types.ObjectId;
  product: Types.ObjectId;
  variantId: Types.ObjectId | null;
  sku: string;
  /** Signed change to quantity on hand. */
  delta: number;
  type: MovementType;
  reference?: { kind: string; id: Types.ObjectId; label?: string } | null;
  reason?: string;
  performedBy: string | null;
  /**
   * When removing stock: false (default) requires enough *available* units (on hand minus reserved);
   * true only requires enough units on hand (authorised overrides and physical count corrections).
   */
  ignoreReservations?: boolean;
  /** Company low-stock default, passed in to avoid re-reading settings for every line. */
  lowStockDefault: number;
}

/**
 * Applies one stock change atomically and records it in the movement ledger.
 * A decrease is a conditional update, so two concurrent sales of the last unit
 * cannot both succeed. Call inside a transaction when several changes must succeed together.
 */
export async function applyStockChange(c: StockChange): Promise<IInventory & { _id: Types.ObjectId }> {
  const key = { product: c.product, variantId: c.variantId, branch: c.branch };
  let after: (IInventory & { _id: Types.ObjectId }) | null;

  if (c.delta >= 0) {
    after = await Inventory.findOneAndUpdate(
      key,
      { $inc: { quantity: c.delta }, $setOnInsert: { sku: c.sku, reserved: 0, reorderLevel: null, isAvailable: true } },
      { upsert: true, returnDocument: 'after' },
    ).lean();
  } else {
    const need = -c.delta;
    const enough = c.ignoreReservations
      ? { quantity: { $gte: need } }
      : { $expr: { $gte: [{ $subtract: ['$quantity', '$reserved'] }, need] } };
    after = await Inventory.findOneAndUpdate({ ...key, ...enough }, { $inc: { quantity: c.delta } }, { returnDocument: 'after' }).lean();
    if (!after) {
      const current = await Inventory.findOne(key).lean();
      const available = current ? (c.ignoreReservations ? current.quantity : current.quantity - current.reserved) : 0;
      throw new AppError(409, 'INSUFFICIENT_STOCK', `Not enough stock for ${c.sku}: ${available} available, ${need} requested.`, {
        sku: c.sku,
        available,
        requested: need,
      });
    }
  }

  await InventoryMovement.create([
    {
      inventory: after!._id,
      product: c.product,
      variantId: c.variantId,
      sku: c.sku,
      branch: c.branch,
      type: c.type,
      quantityDelta: c.delta,
      reservedDelta: 0,
      balanceAfter: after!.quantity,
      reference: c.reference ?? null,
      reason: c.reason,
      performedBy: c.performedBy ? new Types.ObjectId(c.performedBy) : null,
    },
  ]);

  // Alert once, when available stock crosses down to the reorder level.
  const threshold = after!.reorderLevel ?? c.lowStockDefault;
  const availableAfter = after!.quantity - after!.reserved;
  const availableBefore = availableAfter - c.delta;
  if (c.delta < 0 && availableBefore > threshold && availableAfter <= threshold) {
    await enqueue('inventory.low_stock', { inventoryId: after!._id.toString() });
  }
  return after!;
}

export interface ReservationChange {
  branch: Types.ObjectId;
  product: Types.ObjectId;
  variantId: Types.ObjectId | null;
  sku: string;
  /** Positive holds units for a customer; negative releases them. */
  delta: number;
  reference: { kind: string; id: Types.ObjectId; label?: string };
  reason?: string;
  performedBy: string | null;
  lowStockDefault: number;
}

/**
 * Holds (or releases) units for an order or reservation. A hold succeeds only when enough
 * units are available and the item is offered at the branch, so two customers can never be
 * promised the same unit.
 */
export async function applyReservation(c: ReservationChange): Promise<IInventory & { _id: Types.ObjectId }> {
  const key = { product: c.product, variantId: c.variantId, branch: c.branch };
  let after: (IInventory & { _id: Types.ObjectId }) | null;
  if (c.delta > 0) {
    after = await Inventory.findOneAndUpdate(
      { ...key, isAvailable: true, $expr: { $gte: [{ $subtract: ['$quantity', '$reserved'] }, c.delta] } },
      { $inc: { reserved: c.delta } },
      { returnDocument: 'after' },
    ).lean();
    if (!after) {
      throw new AppError(409, 'INSUFFICIENT_STOCK', `Not enough stock for ${c.sku} at this branch.`, { sku: c.sku, requested: c.delta });
    }
  } else {
    after = await Inventory.findOneAndUpdate({ ...key, reserved: { $gte: -c.delta } }, { $inc: { reserved: c.delta } }, { returnDocument: 'after' }).lean();
    if (!after) throw new AppError(409, 'RESERVATION_MISMATCH', `Reserved stock for ${c.sku} is lower than expected.`);
  }
  await InventoryMovement.create([
    {
      inventory: after._id,
      product: c.product,
      variantId: c.variantId,
      sku: c.sku,
      branch: c.branch,
      type: c.delta > 0 ? 'reservation_hold' : 'reservation_release',
      quantityDelta: 0,
      reservedDelta: c.delta,
      balanceAfter: after.quantity,
      reference: c.reference,
      reason: c.reason,
      performedBy: c.performedBy ? new Types.ObjectId(c.performedBy) : null,
    },
  ]);
  const threshold = after.reorderLevel ?? c.lowStockDefault;
  const availableAfter = after.quantity - after.reserved;
  if (c.delta > 0 && availableAfter + c.delta > threshold && availableAfter <= threshold) {
    await enqueue('inventory.low_stock', { inventoryId: after._id.toString() });
  }
  return after;
}

/**
 * Completes a sale of units that were held for an order: on-hand and reserved both drop.
 * Used when a pickup order is completed or a delivery order leaves the branch.
 */
export async function applySale(c: Omit<ReservationChange, 'delta'> & { quantity: number }): Promise<void> {
  const key = { product: c.product, variantId: c.variantId, branch: c.branch };
  const after = await Inventory.findOneAndUpdate(
    { ...key, reserved: { $gte: c.quantity }, quantity: { $gte: c.quantity } },
    { $inc: { quantity: -c.quantity, reserved: -c.quantity } },
    { returnDocument: 'after' },
  ).lean();
  if (!after) throw new AppError(409, 'RESERVATION_MISMATCH', `Held stock for ${c.sku} does not match the order. Check the stock history.`);
  await InventoryMovement.create([
    {
      inventory: after._id, product: c.product, variantId: c.variantId, sku: c.sku, branch: c.branch, type: 'sale',
      quantityDelta: -c.quantity, reservedDelta: -c.quantity, balanceAfter: after.quantity, reference: c.reference, reason: c.reason,
      performedBy: c.performedBy ? new Types.ObjectId(c.performedBy) : null,
    },
  ]);
}

/** Puts sold units back on the shelf (returned delivery, refund with restock). */
export async function applyReturn(c: Omit<ReservationChange, 'delta' | 'lowStockDefault'> & { quantity: number }): Promise<void> {
  const key = { product: c.product, variantId: c.variantId, branch: c.branch };
  const after = await Inventory.findOneAndUpdate(key, { $inc: { quantity: c.quantity }, $setOnInsert: { sku: c.sku, reserved: 0, reorderLevel: null, isAvailable: true } }, { upsert: true, returnDocument: 'after' }).lean();
  await InventoryMovement.create([
    {
      inventory: after!._id, product: c.product, variantId: c.variantId, sku: c.sku, branch: c.branch, type: 'return',
      quantityDelta: c.quantity, reservedDelta: 0, balanceAfter: after!.quantity, reference: c.reference, reason: c.reason,
      performedBy: c.performedBy ? new Types.ObjectId(c.performedBy) : null,
    },
  ]);
}

registerOutboxHandler('inventory.low_stock', async (payload) => {
  const inv = await Inventory.findById(String(payload.inventoryId)).lean();
  if (!inv) return;
  const [product, branch, settings] = await Promise.all([
    Product.findById(inv.product).select('name variants').lean(),
    Branch.findById(inv.branch).select('name code').lean(),
    getSettingsDoc(),
  ]);
  if (!product || !branch) return;
  const variant = inv.variantId ? product.variants.find((v) => v._id.equals(inv.variantId!)) : null;
  // Branch admins of this branch; the super admins if the branch has none.
  let recipients = await User.find({ roleKey: 'BRANCH_ADMIN', status: 'active', branches: inv.branch, email: { $type: 'string' } }).select('email fullName').lean();
  if (!recipients.length) recipients = await User.find({ roleKey: 'SUPER_ADMIN', status: 'active', email: { $type: 'string' } }).select('email fullName').lean();
  const name = variant ? `${product.name} (${variantLabel(variant)})` : product.name;
  await notifyBranchTeam(inv.branch, P.INVENTORY_STOCK_IN, {
    type: 'inventory.low_stock',
    title: `Low stock: ${name}`,
    body: `${inv.quantity - inv.reserved} available at ${branch.code} (reorder level ${inv.reorderLevel ?? settings.lowStockDefault}).`,
    link: `/admin/inventory?branch=${branch._id}&lowStock=true`,
  });
  for (const r of recipients) {
    await sendMailNow(
      lowStockEmail(r.email!, r.fullName, {
        product: name,
        sku: inv.sku,
        branch: `${branch.code} · ${branch.name}`,
        available: inv.quantity - inv.reserved,
        reorderLevel: inv.reorderLevel ?? settings.lowStockDefault,
        link: `${env.WEB_URL}/admin/inventory?branch=${branch._id}&lowStock=true`,
      }),
    );
  }
});

// ------------------------------------------------------------------ helpers

async function requireBranchFor(auth: AuthContext, permission: Permission, branchId: string, opts: { active?: boolean } = {}) {
  if (!auth.canAccessBranch(permission, branchId)) {
    if (auth.canAccessBranch(P.INVENTORY_READ, branchId) || auth.canAccessBranch(P.BRANCHES_READ, branchId)) {
      throw forbidden('You do not have permission to do this at that branch.');
    }
    throw notFound('Branch');
  }
  const branch = await Branch.findById(branchId).select('name code status').lean();
  if (!branch) throw notFound('Branch');
  if (opts.active && branch.status !== 'active') throw badRequest(`${branch.name} is inactive.`);
  return branch;
}

const userRef = (u: unknown) =>
  u && typeof u === 'object' && 'fullName' in u ? { id: (u as unknown as { _id: Types.ObjectId })._id.toString(), fullName: (u as { fullName: string }).fullName } : null;
const branchRef = (b: unknown) => {
  const x = b as { _id: Types.ObjectId; name: string; code: string };
  return { id: x._id.toString(), name: x.name, code: x.code };
};

interface ProductLite { _id: Types.ObjectId; name: string; sku: string; slug: string; images: IImage[]; variants: IVariant[] }

function variantOf(p: ProductLite | null, variantId: Types.ObjectId | null) {
  if (!p || !variantId) return null;
  const v = p.variants.find((x) => x._id.equals(variantId));
  return v ? { id: v._id.toString(), label: variantLabel(v), sku: v.sku } : { id: variantId.toString(), label: 'Removed variant', sku: '' };
}

type PopulatedInventory = Omit<IInventory, 'product' | 'branch'> & { _id: Types.ObjectId; product: ProductLite; branch: { _id: Types.ObjectId; name: string; code: string } };

function inventoryDto(i: PopulatedInventory, lowStockDefault: number): InventoryDto {
  const available = i.quantity - i.reserved;
  const threshold = i.reorderLevel ?? lowStockDefault;
  return {
    id: i._id.toString(),
    branch: branchRef(i.branch),
    product: productRef(i.product),
    variant: variantOf(i.product, i.variantId),
    sku: i.sku,
    quantity: i.quantity,
    reserved: i.reserved,
    available,
    reorderLevel: i.reorderLevel,
    effectiveReorderLevel: threshold,
    level: stockLevel(available, i.isAvailable, threshold),
    isAvailable: i.isAvailable,
    updatedAt: i.updatedAt.toISOString(),
  };
}

const PRODUCT_POP = { path: 'product', select: 'name sku slug images variants' };
const BRANCH_POP = { path: 'branch', select: 'name code' };

async function inventoryDtos(ids: Types.ObjectId[]): Promise<InventoryDto[]> {
  const settings = await getSettingsDoc();
  const rows = await Inventory.find({ _id: { $in: ids } }).populate(PRODUCT_POP).populate(BRANCH_POP).lean<PopulatedInventory[]>();
  return rows.map((r) => inventoryDto(r, settings.lowStockDefault));
}

// ------------------------------------------------------------------ queries

type InventoryQuery = z.output<typeof listInventoryQuery>;

export async function listInventory(auth: AuthContext, q: InventoryQuery): Promise<Page<InventoryDto>> {
  const settings = await getSettingsDoc();
  const filter: Record<string, unknown> = { ...auth.branchFilter(P.INVENTORY_READ) };
  if (q.branch) {
    if (!auth.canAccessBranch(P.INVENTORY_READ, q.branch)) return Page.of([], 0, q.page, q.limit);
    filter.branch = new Types.ObjectId(q.branch);
  }
  if (q.product) filter.product = new Types.ObjectId(q.product);
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    const productIds = await Product.find({ $or: [{ name: rx }, { sku: rx }] }).distinct('_id');
    filter.$or = [{ sku: rx }, { product: { $in: productIds } }];
  }
  const available = { $subtract: ['$quantity', '$reserved'] };
  if (q.outOfStock) filter.$expr = { $lte: [available, 0] };
  else if (q.lowStock) filter.$expr = { $lte: [available, { $ifNull: ['$reorderLevel', settings.lowStockDefault] }] };

  const [rows, total] = await Promise.all([
    Inventory.find(filter)
      .sort(q.lowStock || q.outOfStock ? { quantity: 1, sku: 1 } : { sku: 1, branch: 1 })
      .skip(skipFor(q.page, q.limit))
      .limit(q.limit)
      .populate(PRODUCT_POP)
      .populate(BRANCH_POP)
      .lean<PopulatedInventory[]>(),
    Inventory.countDocuments(filter),
  ]);
  return Page.of(rows.map((r) => inventoryDto(r, settings.lowStockDefault)), total, q.page, q.limit);
}

export async function updateInventory(auth: AuthContext, id: string, input: z.output<typeof updateInventorySchema>, meta: RequestMeta): Promise<InventoryDto> {
  const inv = await Inventory.findById(id);
  if (!inv || !auth.canAccessBranch(P.INVENTORY_READ, inv.branch)) throw notFound('Stock record');
  if (!auth.canAccessBranch(P.INVENTORY_UPDATE, inv.branch)) throw forbidden();
  const before = { reorderLevel: inv.reorderLevel, isAvailable: inv.isAvailable };
  if (input.reorderLevel !== undefined) inv.reorderLevel = input.reorderLevel;
  if (input.isAvailable !== undefined) inv.isAvailable = input.isAvailable;
  await inv.save();
  await audit({ action: 'inventory.settings_changed', actor: auth, branch: inv.branch, entity: { kind: 'Inventory', id: inv._id, label: inv.sku }, before, after: { reorderLevel: inv.reorderLevel, isAvailable: inv.isAvailable } }, meta);
  return (await inventoryDtos([inv._id]))[0]!;
}

type MovementQuery = z.output<typeof listMovementsQuery>;

export async function listMovements(auth: AuthContext, q: MovementQuery): Promise<Page<MovementDto>> {
  const filter: Record<string, unknown> = { ...auth.branchFilter(P.INVENTORY_READ) };
  if (q.branch) {
    if (!auth.canAccessBranch(P.INVENTORY_READ, q.branch)) return Page.of([], 0, q.page, q.limit);
    filter.branch = new Types.ObjectId(q.branch);
  }
  if (q.product) filter.product = new Types.ObjectId(q.product);
  if (q.type) filter.type = q.type;
  if (q.q) filter.sku = new RegExp(escapeRegex(q.q), 'i');
  if (q.from || q.to) filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const [rows, total] = await Promise.all([
    InventoryMovement.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skipFor(q.page, q.limit))
      .limit(q.limit)
      .populate(PRODUCT_POP)
      .populate(BRANCH_POP)
      .populate('performedBy', 'fullName')
      .lean(),
    InventoryMovement.countDocuments(filter),
  ]);
  return Page.of(
    rows.map((m) => {
      const product = m.product as unknown as ProductLite;
      const v = variantOf(product, m.variantId);
      return {
        id: m._id.toString(),
        branch: branchRef(m.branch),
        product: productRef(product),
        variant: v ? { id: v.id, label: v.label } : null,
        sku: m.sku,
        type: m.type,
        quantityDelta: m.quantityDelta,
        reservedDelta: m.reservedDelta,
        balanceAfter: m.balanceAfter,
        reference: m.reference?.kind ? { kind: m.reference.kind, id: m.reference.id.toString(), label: m.reference.label ?? null } : null,
        reason: m.reason ?? null,
        performedBy: userRef(m.performedBy),
        createdAt: m.createdAt.toISOString(),
      };
    }),
    total,
    q.page,
    q.limit,
  );
}

// ------------------------------------------------------------------ stock in / stock out

export async function stockIn(auth: AuthContext, input: z.output<typeof stockInSchema>, meta: RequestMeta): Promise<InventoryDto[]> {
  const branch = await requireBranchFor(auth, P.INVENTORY_STOCK_IN, input.branch, { active: true });
  const receiptId = new Types.ObjectId();
  const ids = await withTransaction(async () => {
    const settings = await getSettingsDoc();
    const out: Types.ObjectId[] = [];
    for (const item of input.items) {
      const r = await resolveStockItem(item.product, item.variantId);
      const inv = await applyStockChange({
        branch: branch._id,
        product: r.product._id,
        variantId: r.variant?._id ?? null,
        sku: r.sku,
        delta: item.quantity,
        type: 'stock_in',
        reference: { kind: 'StockReceipt', id: receiptId, label: input.reference },
        reason: input.note,
        performedBy: auth.userId,
        lowStockDefault: settings.lowStockDefault,
      });
      out.push(inv._id);
    }
    await audit(
      {
        action: 'inventory.stock_in',
        actor: auth,
        branch: branch._id,
        entity: { kind: 'StockReceipt', id: receiptId, label: input.reference ?? `${input.items.length} line(s)` },
        meta: { items: input.items, reference: input.reference, note: input.note },
      },
      meta,
    );
    return out;
  });
  return inventoryDtos(ids);
}

export async function stockOut(auth: AuthContext, input: z.output<typeof stockOutSchema>, meta: RequestMeta): Promise<InventoryDto[]> {
  const branch = await requireBranchFor(auth, P.INVENTORY_STOCK_OUT, input.branch);
  const override = auth.canAccessBranch(P.INVENTORY_OVERRIDE, input.branch);
  const ref = new Types.ObjectId();
  const ids = await withTransaction(async () => {
    const settings = await getSettingsDoc();
    const out: Types.ObjectId[] = [];
    for (const item of input.items) {
      const r = await resolveStockItem(item.product, item.variantId);
      const inv = await applyStockChange({
        branch: branch._id,
        product: r.product._id,
        variantId: r.variant?._id ?? null,
        sku: r.sku,
        delta: -item.quantity,
        type: 'stock_out',
        reference: { kind: 'StockRemoval', id: ref, label: input.reason },
        reason: [input.reason.replace(/_/g, ' '), input.note].filter(Boolean).join(': '),
        performedBy: auth.userId,
        ignoreReservations: override,
        lowStockDefault: settings.lowStockDefault,
      });
      out.push(inv._id);
    }
    await audit({ action: 'inventory.stock_out', actor: auth, branch: branch._id, entity: { kind: 'StockRemoval', id: ref, label: input.reason }, meta: { items: input.items, reason: input.reason, note: input.note, override } }, meta);
    return out;
  });
  return inventoryDtos(ids);
}

// ------------------------------------------------------------------ adjustments

type PopulatedAdjustment = Omit<StockAdjustmentDoc, never>;

async function adjustmentDto(id: Types.ObjectId): Promise<AdjustmentDto> {
  const a = await StockAdjustment.findById(id).populate(BRANCH_POP).populate('requestedBy', 'fullName').populate('reviewedBy', 'fullName').lean();
  if (!a) throw notFound('Adjustment');
  const products = await Product.find({ _id: { $in: a.items.map((i) => i.product) } }).select('name sku slug images variants').lean<ProductLite[]>();
  const byId = new Map(products.map((p) => [p._id.toString(), p]));
  return {
    id: a._id.toString(),
    reference: a.reference,
    branch: branchRef(a.branch),
    items: a.items.map((i) => {
      const p = byId.get(i.product.toString()) ?? null;
      const v = variantOf(p, i.variantId);
      return {
        product: p ? productRef(p) : { id: i.product.toString(), name: i.name, sku: i.sku, slug: '', image: null },
        variant: v ? { id: v.id, label: v.label } : null,
        sku: i.sku,
        delta: i.delta,
      };
    }),
    reason: a.reason,
    status: a.status,
    requestedBy: userRef(a.requestedBy),
    reviewedBy: userRef(a.reviewedBy),
    reviewNote: a.reviewNote ?? null,
    reviewedAt: a.reviewedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

async function applyAdjustment(adj: PopulatedAdjustment, performedBy: string) {
  const settings = await getSettingsDoc();
  for (const item of adj.items) {
    await applyStockChange({
      branch: adj.branch,
      product: item.product,
      variantId: item.variantId,
      sku: item.sku,
      delta: item.delta,
      type: 'adjustment',
      reference: { kind: 'StockAdjustment', id: adj._id, label: adj.reference },
      reason: adj.reason,
      performedBy,
      // A count correction reflects what is physically there, even if units are reserved.
      ignoreReservations: true,
      lowStockDefault: settings.lowStockDefault,
    });
  }
}

/**
 * Small corrections by someone allowed to approve are applied at once. Anything above the
 * company threshold, and every request from staff without approval rights, waits for a second person.
 */
export async function createAdjustment(auth: AuthContext, input: z.output<typeof adjustmentSchema>, meta: RequestMeta): Promise<AdjustmentDto> {
  const branch = await requireBranchFor(auth, P.INVENTORY_ADJUST, input.branch, { active: true });
  const id = await withTransaction(async () => {
    const settings = await getSettingsDoc();
    const items = [];
    for (const i of input.items) {
      const r = await resolveStockItem(i.product, i.variantId);
      items.push({ product: r.product._id, variantId: r.variant?._id ?? null, sku: r.sku, name: r.name, delta: i.delta });
    }
    const canApprove = auth.canAccessBranch(P.INVENTORY_APPROVE_ADJUSTMENT, input.branch);
    const small = items.every((i) => Math.abs(i.delta) <= settings.adjustmentApprovalThreshold);
    const autoApply = canApprove && small;
    const [adj] = await StockAdjustment.create([
      {
        reference: await nextReference('ADJ', branch.code),
        branch: branch._id,
        items,
        reason: input.reason,
        status: autoApply ? 'applied' : 'pending',
        requestedBy: auth.userId,
        reviewedBy: autoApply ? auth.userId : null,
        reviewedAt: autoApply ? new Date() : null,
        reviewNote: autoApply ? 'Applied directly (within the approval threshold)' : undefined,
      },
    ]);
    if (autoApply) await applyAdjustment(adj!, auth.userId);
    else await notifyBranchTeam(branch._id, P.INVENTORY_APPROVE_ADJUSTMENT, { type: 'inventory.adjustment_pending', title: `Stock correction ${adj!.reference} needs approval`, body: `${auth.fullName}: ${input.reason}`, link: '/admin/inventory/adjustments' }, true);
    await audit({ action: autoApply ? 'inventory.adjustment_applied' : 'inventory.adjustment_requested', actor: auth, branch: branch._id, entity: { kind: 'StockAdjustment', id: adj!._id, label: adj!.reference }, meta: { items: input.items, reason: input.reason } }, meta);
    return adj!._id;
  });
  return adjustmentDto(id);
}

export async function reviewAdjustment(auth: AuthContext, id: string, decision: 'approve' | 'reject', note: string | undefined, meta: RequestMeta): Promise<AdjustmentDto> {
  await withTransaction(async () => {
    const adj = await StockAdjustment.findById(id);
    if (!adj || !auth.canAccessBranch(P.INVENTORY_READ, adj.branch)) throw notFound('Adjustment');
    if (!auth.canAccessBranch(P.INVENTORY_APPROVE_ADJUSTMENT, adj.branch)) throw forbidden('You cannot approve stock adjustments at this branch.');
    if (adj.status !== 'pending') throw conflict(`This adjustment has already been ${adj.status}.`, undefined, 'INVALID_STATE');
    if (adj.requestedBy.equals(auth.userId)) throw forbidden('Someone else must review your adjustment.', 'SELF_APPROVAL');
    adj.status = decision === 'approve' ? 'applied' : 'rejected';
    adj.reviewedBy = new Types.ObjectId(auth.userId);
    adj.reviewedAt = new Date();
    adj.reviewNote = note;
    await adj.save(); // optimistic concurrency: a parallel review fails with 409
    if (decision === 'approve') await applyAdjustment(adj, auth.userId);
    await audit({ action: decision === 'approve' ? 'inventory.adjustment_approved' : 'inventory.adjustment_rejected', actor: auth, branch: adj.branch, entity: { kind: 'StockAdjustment', id: adj._id, label: adj.reference }, meta: { note } }, meta);
  });
  return adjustmentDto(new Types.ObjectId(id));
}

export async function listAdjustments(auth: AuthContext, q: z.output<typeof listAdjustmentsQuery>): Promise<Page<AdjustmentDto>> {
  const filter: Record<string, unknown> = { ...auth.branchFilter(P.INVENTORY_READ) };
  if (q.branch) {
    if (!auth.canAccessBranch(P.INVENTORY_READ, q.branch)) return Page.of([], 0, q.page, q.limit);
    filter.branch = new Types.ObjectId(q.branch);
  }
  if (q.status) filter.status = q.status;
  if (q.q) filter.reference = new RegExp(escapeRegex(q.q), 'i');
  const [rows, total] = await Promise.all([
    StockAdjustment.find(filter).sort({ status: 1, createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).select('_id'),
    StockAdjustment.countDocuments(filter),
  ]);
  return Page.of(await Promise.all(rows.map((r) => adjustmentDto(r._id))), total, q.page, q.limit);
}

// ------------------------------------------------------------------ transfers

function allowedTransferActions(auth: AuthContext, t: Pick<StockTransferDoc, 'status' | 'fromBranch' | 'toBranch' | 'requestedBy'>): TransferDto['allowedActions'] {
  const out: TransferDto['allowedActions'] = [];
  const approver = auth.can(P.INVENTORY_TRANSFER_APPROVE);
  if (t.status === 'requested' && approver) out.push('approve', 'reject');
  if (t.status === 'approved' && auth.canAccessBranch(P.INVENTORY_STOCK_OUT, t.fromBranch)) out.push('dispatch');
  if (t.status === 'in_transit' && auth.canAccessBranch(P.INVENTORY_STOCK_IN, t.toBranch)) out.push('receive');
  if ((t.status === 'requested' || t.status === 'approved') && (approver || t.requestedBy.equals(auth.userId))) out.push('cancel');
  return out;
}

async function transferDto(auth: AuthContext, id: Types.ObjectId): Promise<TransferDto> {
  const t = await StockTransfer.findById(id)
    .populate('fromBranch', 'name code')
    .populate('toBranch', 'name code')
    .populate('requestedBy', 'fullName')
    .populate('history.by', 'fullName')
    .lean();
  if (!t) throw notFound('Transfer');
  const products = await Product.find({ _id: { $in: t.items.map((i) => i.product) } }).select('name sku slug images variants').lean<ProductLite[]>();
  const byId = new Map(products.map((p) => [p._id.toString(), p]));
  const raw = { status: t.status, fromBranch: (t.fromBranch as unknown as { _id: Types.ObjectId })._id, toBranch: (t.toBranch as unknown as { _id: Types.ObjectId })._id, requestedBy: (t.requestedBy as unknown as { _id: Types.ObjectId })._id };
  return {
    id: t._id.toString(),
    reference: t.reference,
    fromBranch: branchRef(t.fromBranch),
    toBranch: branchRef(t.toBranch),
    items: t.items.map((i) => {
      const p = byId.get(i.product.toString()) ?? null;
      const v = variantOf(p, i.variantId);
      return { product: p ? productRef(p) : { id: i.product.toString(), name: i.name, sku: i.sku, slug: '', image: null }, variant: v ? { id: v.id, label: v.label } : null, sku: i.sku, quantity: i.quantity };
    }),
    status: t.status,
    note: t.note ?? null,
    history: t.history.map((h) => ({ status: h.status, by: userRef(h.by), at: h.at.toISOString(), note: h.note ?? null })),
    requestedBy: userRef(t.requestedBy),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    allowedActions: allowedTransferActions(auth, raw as never),
  };
}

function canSeeTransfer(auth: AuthContext, t: Pick<StockTransferDoc, 'fromBranch' | 'toBranch'>) {
  return auth.canAccessBranch(P.INVENTORY_READ, t.fromBranch) || auth.canAccessBranch(P.INVENTORY_READ, t.toBranch);
}

export async function createTransfer(auth: AuthContext, input: z.output<typeof transferSchema>, meta: RequestMeta): Promise<TransferDto> {
  if (!auth.canAccessBranch(P.INVENTORY_TRANSFER_REQUEST, input.fromBranch) && !auth.canAccessBranch(P.INVENTORY_TRANSFER_REQUEST, input.toBranch) && !auth.can(P.INVENTORY_TRANSFER_APPROVE)) {
    throw forbidden('You can only request transfers into or out of your own branches.');
  }
  const [from, to] = await Promise.all([Branch.findById(input.fromBranch).lean(), Branch.findById(input.toBranch).lean()]);
  if (!from || !to) throw badRequest('Choose existing branches.');
  if (from.status !== 'active' || to.status !== 'active') throw badRequest('Both branches must be active.');

  const id = await withTransaction(async () => {
    const items = [];
    for (const i of input.items) {
      const r = await resolveStockItem(i.product, i.variantId);
      items.push({ product: r.product._id, variantId: r.variant?._id ?? null, sku: r.sku, name: r.name, quantity: i.quantity });
    }
    // A head-office request is approved as it is made.
    const autoApprove = auth.can(P.INVENTORY_TRANSFER_APPROVE);
    const now = new Date();
    const [t] = await StockTransfer.create([
      {
        reference: await nextReference('TRF', from.code),
        fromBranch: from._id,
        toBranch: to._id,
        items,
        note: input.note,
        status: autoApprove ? 'approved' : 'requested',
        requestedBy: auth.userId,
        history: [
          { status: 'requested', by: auth.userId, at: now, note: input.note },
          ...(autoApprove ? [{ status: 'approved' as const, by: auth.userId, at: now }] : []),
        ],
      },
    ]);
    if (autoApprove) await notifyBranchTeam(from._id, P.INVENTORY_STOCK_OUT, { type: 'transfer.approved', title: `Send transfer ${t!.reference}`, body: `Prepare and dispatch the items to ${to.name}.`, link: `/admin/inventory/transfers/${t!._id}` });
    else await notifyHeadOffice(P.INVENTORY_TRANSFER_APPROVE, { type: 'transfer.requested', title: `Transfer ${t!.reference} needs approval`, body: `${from.name} → ${to.name}, requested by ${auth.fullName}.`, link: `/admin/inventory/transfers/${t!._id}` });
    await audit({ action: 'inventory.transfer_requested', actor: auth, branch: from._id, entity: { kind: 'StockTransfer', id: t!._id, label: t!.reference }, meta: { to: to.code, items: input.items } }, meta);
    return t!._id;
  });
  return transferDto(auth, id);
}

const NEXT_STATUS: Record<TransferAction, { from: TransferStatus[]; to: TransferStatus }> = {
  approve: { from: ['requested'], to: 'approved' },
  reject: { from: ['requested'], to: 'rejected' },
  dispatch: { from: ['approved'], to: 'in_transit' },
  receive: { from: ['in_transit'], to: 'received' },
  cancel: { from: ['requested', 'approved'], to: 'cancelled' },
};

export async function actOnTransfer(auth: AuthContext, id: string, action: TransferAction, note: string | undefined, meta: RequestMeta): Promise<TransferDto> {
  await withTransaction(async () => {
    const t = await StockTransfer.findById(id);
    if (!t || !canSeeTransfer(auth, t)) {
      if (!t || !auth.can(P.INVENTORY_TRANSFER_APPROVE)) throw notFound('Transfer');
    }
    const rule = NEXT_STATUS[action];
    if (!rule.from.includes(t!.status)) {
      throw conflict(`A ${t!.status.replace('_', ' ')} transfer cannot be ${action === 'dispatch' ? 'dispatched' : `${action}d`}.`, undefined, 'INVALID_STATE');
    }
    if (!allowedTransferActions(auth, t!).includes(action)) throw forbidden('You are not allowed to take this step for this transfer.');

    const settings = await getSettingsDoc();
    if (action === 'dispatch' || action === 'receive') {
      const out = action === 'dispatch';
      for (const item of t!.items) {
        await applyStockChange({
          branch: out ? t!.fromBranch : t!.toBranch,
          product: item.product,
          variantId: item.variantId,
          sku: item.sku,
          delta: out ? -item.quantity : item.quantity,
          type: out ? 'transfer_out' : 'transfer_in',
          reference: { kind: 'StockTransfer', id: t!._id, label: t!.reference },
          reason: note,
          performedBy: auth.userId,
          lowStockDefault: settings.lowStockDefault,
        });
      }
    }
    t!.status = rule.to;
    t!.history.push({ status: rule.to, by: new Types.ObjectId(auth.userId), at: new Date(), note });
    await t!.save(); // optimistic concurrency: two people dispatching at once -> one gets 409
    const tLink = `/admin/inventory/transfers/${t!._id}`;
    if (rule.to === 'approved') await notifyBranchTeam(t!.fromBranch, P.INVENTORY_STOCK_OUT, { type: 'transfer.approved', title: `Send transfer ${t!.reference}`, body: 'Head office approved it. Prepare and dispatch the items.', link: tLink });
    if (rule.to === 'in_transit') await notifyBranchTeam(t!.toBranch, P.INVENTORY_STOCK_IN, { type: 'transfer.in_transit', title: `Transfer ${t!.reference} is on its way`, body: 'Count the items when they arrive, then confirm receipt.', link: tLink });
    if (['received', 'rejected', 'cancelled'].includes(rule.to)) await notifyUsers([t!.requestedBy], { type: `transfer.${rule.to}`, title: `Transfer ${t!.reference} ${rule.to}`, body: note ?? `The transfer was ${rule.to}.`, link: tLink });
    await audit({ action: `inventory.transfer_${rule.to}`, actor: auth, branch: action === 'receive' ? t!.toBranch : t!.fromBranch, entity: { kind: 'StockTransfer', id: t!._id, label: t!.reference }, meta: { note } }, meta);
  });
  return transferDto(auth, new Types.ObjectId(id));
}

export async function getTransfer(auth: AuthContext, id: string): Promise<TransferDto> {
  const t = await StockTransfer.findById(id).select('fromBranch toBranch');
  if (!t || !(canSeeTransfer(auth, t) || auth.can(P.INVENTORY_TRANSFER_APPROVE))) throw notFound('Transfer');
  return transferDto(auth, t._id);
}

export async function listTransfers(auth: AuthContext, q: z.output<typeof listTransfersQuery>): Promise<Page<TransferDto>> {
  const scope = auth.branchesFor(P.INVENTORY_READ);
  const filter: Record<string, unknown> = {};
  if (scope !== 'ALL') {
    const ids = scope.map((s) => new Types.ObjectId(s));
    filter.$or = [{ fromBranch: { $in: ids } }, { toBranch: { $in: ids } }];
  }
  if (q.branch) {
    if (scope !== 'ALL' && !scope.includes(q.branch)) return Page.of([], 0, q.page, q.limit);
    const b = new Types.ObjectId(q.branch);
    filter.$and = [{ $or: [{ fromBranch: b }, { toBranch: b }] }];
  }
  if (q.status) filter.status = q.status;
  if (q.q) filter.reference = new RegExp(escapeRegex(q.q), 'i');
  const [rows, total] = await Promise.all([
    StockTransfer.find(filter).sort({ updatedAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).select('_id'),
    StockTransfer.countDocuments(filter),
  ]);
  return Page.of(await Promise.all(rows.map((r) => transferDto(auth, r._id))), total, q.page, q.limit);
}
