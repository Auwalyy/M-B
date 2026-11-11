import {
  type DeliveryZoneDto,
  PERMISSIONS,
  type PromotionDto,
  type PublicPromotionDto,
  type deliveryZoneSchema,
  type promotionSchema,
  type updateDeliveryZoneSchema,
  type updatePromotionSchema,
} from '@mb/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import type { AuthContext } from '../../core/auth/AuthContext';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors/AppError';
import type { RequestMeta } from '../../core/http/route';
import { audit, pick } from '../audit/audit.service';
import { Branch } from '../branches/branch.model';
import { DeliveryZone, type IDeliveryZone, type IPromotion, Order, Promotion, type PromotionDoc } from './commerce.models';

const P = PERMISSIONS;
const ids = (a: Types.ObjectId[]) => a.map(String);

const isLive = (p: Pick<IPromotion, 'status' | 'startsAt' | 'endsAt'>, now = new Date()) => p.status === 'active' && p.startsAt <= now && p.endsAt > now;

function promotionDto(p: PromotionDoc | (IPromotion & { _id: Types.ObjectId })): PromotionDto {
  return {
    id: p._id.toString(),
    name: p.name,
    code: p.code ?? null,
    description: p.description ?? null,
    type: p.type,
    value: p.value,
    products: ids(p.products),
    categories: ids(p.categories),
    brands: ids(p.brands),
    branches: ids(p.branches),
    minOrderAmount: p.minOrderAmount ?? null,
    maxDiscount: p.maxDiscount ?? null,
    startsAt: p.startsAt.toISOString(),
    endsAt: p.endsAt.toISOString(),
    usageLimit: p.usageLimit ?? null,
    perCustomerLimit: p.perCustomerLimit ?? null,
    usedCount: p.usedCount,
    status: p.status,
    live: isLive(p),
  };
}

export async function listPromotions(): Promise<PromotionDto[]> {
  return (await Promotion.find().sort({ endsAt: -1 }).lean()).map(promotionDto);
}

/** Running promotions for the storefront (banners, product badges). */
export async function listPublicPromotions(): Promise<PublicPromotionDto[]> {
  const now = new Date();
  const rows = await Promotion.find({ status: 'active', startsAt: { $lte: now }, endsAt: { $gt: now } }).sort({ endsAt: 1 }).lean();
  return rows
    .filter((p) => p.usageLimit == null || p.usedCount < p.usageLimit)
    .map((p) => ({ id: p._id.toString(), name: p.name, code: p.code ?? null, description: p.description ?? null, type: p.type, value: p.value, minOrderAmount: p.minOrderAmount ?? null, endsAt: p.endsAt.toISOString() }));
}

export async function createPromotion(auth: AuthContext, input: z.output<typeof promotionSchema>, meta: RequestMeta): Promise<PromotionDto> {
  if (input.code && (await Promotion.exists({ code: input.code }))) throw conflict('Another promotion already uses this code.', { code: ['Already used'] }, 'DUPLICATE');
  const p = await Promotion.create({ ...input, code: input.code ?? null, createdBy: auth.userId });
  await audit({ action: 'promotion.created', actor: auth, entity: { kind: 'Promotion', id: p._id, label: p.name }, after: pick(p, ['name', 'code', 'type', 'value', 'startsAt', 'endsAt', 'status']) }, meta);
  return promotionDto(p);
}

export async function updatePromotion(auth: AuthContext, id: string, input: z.output<typeof updatePromotionSchema>, meta: RequestMeta): Promise<PromotionDto> {
  const p = await Promotion.findById(id);
  if (!p) throw notFound('Promotion');
  if (input.code && input.code !== p.code && (await Promotion.exists({ code: input.code, _id: { $ne: p._id } }))) {
    throw conflict('Another promotion already uses this code.', { code: ['Already used'] }, 'DUPLICATE');
  }
  const before = pick(p, ['name', 'code', 'type', 'value', 'startsAt', 'endsAt', 'status']);
  p.set(input);
  if (p.endsAt <= p.startsAt) throw badRequest('End must be after the start.', { endsAt: ['End must be after the start'] });
  await p.save();
  await audit({ action: 'promotion.updated', actor: auth, entity: { kind: 'Promotion', id: p._id, label: p.name }, before, after: pick(p, ['name', 'code', 'type', 'value', 'startsAt', 'endsAt', 'status']) }, meta);
  return promotionDto(p);
}

// ------------------------------------------------------------------ evaluation

export interface PricedLine {
  product: Types.ObjectId;
  categoryPath: Types.ObjectId[];
  brand: Types.ObjectId | null;
  lineTotal: number;
}

export interface PromotionResult {
  promotion: IPromotion & { _id: Types.ObjectId };
  /** Discount on items. */
  discount: number;
  freeDelivery: boolean;
}

function eligibleSubtotal(p: IPromotion, lines: PricedLine[]): number {
  const anyScope = p.products.length || p.categories.length || p.brands.length;
  return lines
    .filter(
      (l) =>
        !anyScope ||
        p.products.some((x) => x.equals(l.product)) ||
        p.categories.some((c) => l.categoryPath.some((x) => x.equals(c))) ||
        (l.brand ? p.brands.some((b) => b.equals(l.brand!)) : false),
    )
    .reduce((n, l) => n + l.lineTotal, 0);
}

/** Returns the result, or a reason the promotion does not apply. */
export async function evaluatePromotion(
  p: IPromotion & { _id: Types.ObjectId },
  ctx: { lines: PricedLine[]; subtotal: number; branch: Types.ObjectId; customerId: Types.ObjectId | null },
): Promise<PromotionResult | { reason: string }> {
  if (!isLive(p)) return { reason: 'This code has expired or is not active yet.' };
  if (p.usageLimit != null && p.usedCount >= p.usageLimit) return { reason: 'This promotion has been fully used.' };
  if (p.branches.length && !p.branches.some((b) => b.equals(ctx.branch))) return { reason: 'This code is not valid at the chosen branch.' };
  if (p.minOrderAmount && ctx.subtotal < p.minOrderAmount) return { reason: `Spend at least ₦${(p.minOrderAmount / 100).toLocaleString('en-NG')} to use this code.` };
  if (p.perCustomerLimit && ctx.customerId) {
    const used = await Order.countDocuments({ 'promotion.id': p._id, customer: ctx.customerId, status: { $ne: 'cancelled' } });
    if (used >= p.perCustomerLimit) return { reason: 'You have already used this promotion.' };
  }
  if (p.type === 'free_delivery') return { promotion: p, discount: 0, freeDelivery: true };
  const eligible = eligibleSubtotal(p, ctx.lines);
  if (eligible <= 0) return { reason: 'None of the items in your cart qualify for this code.' };
  let discount = p.type === 'percentage' ? Math.round((eligible * p.value) / 100) : Math.min(p.value, eligible);
  if (p.maxDiscount) discount = Math.min(discount, p.maxDiscount);
  return { promotion: p, discount, freeDelivery: false };
}

/** Code given: that promotion or a reason. No code: the best automatic (code-less) promotion, if any. */
export async function choosePromotion(
  code: string | undefined,
  ctx: Parameters<typeof evaluatePromotion>[1] & { deliveryFee: number },
): Promise<{ result: PromotionResult | null; message: string | null }> {
  if (code) {
    const p = await Promotion.findOne({ code }).lean();
    if (!p) return { result: null, message: 'That promo code was not recognised.' };
    const r = await evaluatePromotion(p, ctx);
    return 'reason' in r ? { result: null, message: r.reason } : { result: r, message: null };
  }
  const now = new Date();
  const auto = await Promotion.find({ code: null, status: 'active', startsAt: { $lte: now }, endsAt: { $gt: now } }).lean();
  let best: PromotionResult | null = null;
  const worth = (r: PromotionResult) => r.discount + (r.freeDelivery ? ctx.deliveryFee : 0);
  for (const p of auto) {
    const r = await evaluatePromotion(p, ctx);
    if (!('reason' in r) && (!best || worth(r) > worth(best))) best = r;
  }
  return { result: best, message: null };
}

// ------------------------------------------------------------------ delivery zones

type ZoneLean = IDeliveryZone & { _id: Types.ObjectId; branch: { _id: Types.ObjectId; name: string; code: string } };

function zoneDto(z: ZoneLean): DeliveryZoneDto {
  return {
    id: z._id.toString(),
    branch: { id: z.branch._id.toString(), name: z.branch.name, code: z.branch.code },
    name: z.name,
    areas: z.areas,
    fee: z.fee,
    freeAbove: z.freeAbove ?? null,
    estimatedDays: z.estimatedDays,
    status: z.status,
  };
}

/** Visitors see active zones; staff with delivery-zone rights see every zone of their branches. */
export async function listZones(auth: AuthContext | null, branch?: string): Promise<DeliveryZoneDto[]> {
  const staff = auth?.can(P.DELIVERY_ZONES_MANAGE) ? auth : null;
  const filter: Record<string, unknown> = staff ? staff.branchFilter(P.DELIVERY_ZONES_MANAGE) : { status: 'active' };
  if (branch) {
    if (staff && !staff.canAccessBranch(P.DELIVERY_ZONES_MANAGE, branch)) return [];
    filter.branch = new Types.ObjectId(branch);
  }
  const rows = await DeliveryZone.find(filter).sort({ fee: 1, name: 1 }).populate('branch', 'name code').lean<ZoneLean[]>();
  return rows.map(zoneDto);
}

async function loadZone(id: Types.ObjectId | string): Promise<DeliveryZoneDto> {
  const z = await DeliveryZone.findById(id).populate('branch', 'name code').lean<ZoneLean>();
  if (!z) throw notFound('Delivery zone');
  return zoneDto(z);
}

export async function createZone(auth: AuthContext, input: z.output<typeof deliveryZoneSchema>, meta: RequestMeta): Promise<DeliveryZoneDto> {
  if (!auth.canAccessBranch(P.DELIVERY_ZONES_MANAGE, input.branch)) throw forbidden('You can only set delivery areas for your own branches.');
  if (!(await Branch.exists({ _id: input.branch }))) throw badRequest('Branch not found.');
  const zone = await DeliveryZone.create(input);
  await audit({ action: 'delivery_zone.created', actor: auth, branch: zone.branch, entity: { kind: 'DeliveryZone', id: zone._id, label: zone.name }, after: pick(zone, ['name', 'fee', 'freeAbove', 'areas']) }, meta);
  return loadZone(zone._id);
}

export async function updateZone(auth: AuthContext, id: string, input: z.output<typeof updateDeliveryZoneSchema>, meta: RequestMeta): Promise<DeliveryZoneDto> {
  const zone = await DeliveryZone.findById(id);
  if (!zone || !auth.canAccessBranch(P.DELIVERY_ZONES_MANAGE, zone.branch)) throw notFound('Delivery zone');
  const before = pick(zone, ['name', 'fee', 'freeAbove', 'areas', 'status']);
  zone.set(input);
  await zone.save();
  await audit({ action: 'delivery_zone.updated', actor: auth, branch: zone.branch, entity: { kind: 'DeliveryZone', id: zone._id, label: zone.name }, before, after: pick(zone, ['name', 'fee', 'freeAbove', 'areas', 'status']) }, meta);
  return loadZone(zone._id);
}
