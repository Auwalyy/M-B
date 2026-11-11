import { type CartDto, type CartLineDto, type QuoteDto, type cartItemSchema, type quoteSchema } from '@mb/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { hashToken, randomToken } from '../../core/auth/tokens';
import { badRequest, notFound } from '../../core/errors/AppError';
import { Branch } from '../branches/branch.model';
import { type IImage, type IProduct, type IVariant, Product, variantLabel } from '../catalog/catalog.models';
import { imageDto, stockLevel } from '../catalog/catalog.service';
import { Inventory } from '../inventory/inventory.models';
import { getSettingsDoc } from '../settings/settings.service';
import { Cart, type CartDoc, DeliveryZone } from './commerce.models';
import { type PricedLine, type PromotionResult, choosePromotion } from './promotion.service';

const MAX_LINES = 30;
const GUEST_TTL_MS = 30 * 86_400_000;

/** Who owns the cart: a signed-in user, or a guest identified by a cookie token. */
export interface CartOwner {
  userId?: string | null;
  guestToken?: string | null;
}

export function newGuestToken(): string {
  return randomToken(24);
}

async function findCart(owner: CartOwner): Promise<CartDoc | null> {
  if (owner.userId) return Cart.findOne({ user: owner.userId });
  if (owner.guestToken) return Cart.findOne({ guestTokenHash: hashToken(owner.guestToken) });
  return null;
}

async function getOrCreateCart(owner: CartOwner): Promise<CartDoc> {
  const filter = owner.userId ? { user: new Types.ObjectId(owner.userId) } : { guestTokenHash: hashToken(owner.guestToken!) };
  const cart = await Cart.findOneAndUpdate(filter, { $setOnInsert: { ...filter, items: [] } }, { upsert: true, returnDocument: 'after' });
  return cart!;
}

function touch(cart: CartDoc, owner: CartOwner) {
  cart.expiresAt = owner.userId ? null : new Date(Date.now() + GUEST_TTL_MS);
}

// ------------------------------------------------------------------ pricing

type ProductLite = Pick<IProduct, 'name' | 'slug' | 'sku' | 'price' | 'discountPrice' | 'status' | 'hasVariants' | 'categoryPath' | 'brand'> & {
  _id: Types.ObjectId;
  images: IImage[];
  variants: IVariant[];
};

export interface ResolvedLine {
  dto: CartLineDto;
  product: ProductLite | null;
  variant: IVariant | null;
  quantity: number;
  /** Ready to order from the chosen branch. */
  ok: boolean;
}

/** Unit price: variant discount, variant price, product discount, product price (first that is set). */
export function unitPriceFor(p: Pick<IProduct, 'price' | 'discountPrice'>, v: Pick<IVariant, 'price' | 'discountPrice'> | null) {
  const regular = v?.price ?? p.price;
  const sale = v ? (v.discountPrice ?? (v.price == null ? p.discountPrice : null)) : p.discountPrice;
  const unit = sale ?? regular;
  return { unit, compareAt: unit < regular ? regular : null };
}

export async function resolveLines(cart: Pick<CartDoc, 'items' | 'branch'>, branchName?: string): Promise<ResolvedLine[]> {
  const products = await Product.find({ _id: { $in: cart.items.map((i) => i.product) } })
    .select('name slug sku price discountPrice status hasVariants variants images categoryPath brand')
    .lean<ProductLite[]>();
  const byId = new Map(products.map((p) => [p._id.toString(), p]));
  const [settings, stock] = await Promise.all([
    getSettingsDoc(),
    cart.branch ? Inventory.find({ branch: cart.branch, product: { $in: cart.items.map((i) => i.product) } }).lean() : Promise.resolve([]),
  ]);

  return cart.items.map((item) => {
    const p = byId.get(item.product.toString()) ?? null;
    const v = p && item.variantId ? p.variants.find((x) => x._id.equals(item.variantId!)) ?? null : null;
    const key = `${item.product}:${item.variantId ?? ''}`;
    let problem: string | null = null;
    if (!p || p.status !== 'active') problem = 'This product is no longer available.';
    else if (p.hasVariants && (!v || v.status !== 'active')) problem = 'This option is no longer available.';

    const price = p ? unitPriceFor(p, v) : { unit: 0, compareAt: null };
    let level: CartLineDto['level'] = null;
    if (cart.branch && p) {
      const row = stock.find((s) => s.product.equals(p._id) && String(s.variantId ?? '') === String(item.variantId ?? ''));
      const available = row ? row.quantity - row.reserved : 0;
      level = row ? stockLevel(available, row.isAvailable, row.reorderLevel ?? settings.lowStockDefault) : 'out';
      if (!problem && (!row || !row.isAvailable || available < item.quantity)) {
        problem = level === 'out' ? `Out of stock at ${branchName ?? 'this branch'}.` : `Not enough stock at ${branchName ?? 'this branch'} for this quantity.`;
      }
    }
    return {
      product: p,
      variant: v,
      quantity: item.quantity,
      ok: !problem,
      dto: {
        key,
        product: p
          ? { id: p._id.toString(), name: p.name, slug: p.slug, sku: p.sku, image: imageDto(p.images[0]), status: p.status }
          : { id: item.product.toString(), name: 'Unavailable product', slug: '', sku: '', image: null, status: 'inactive' },
        variant: v ? { id: v._id.toString(), label: variantLabel(v), sku: v.sku } : null,
        quantity: item.quantity,
        unitPrice: price.unit,
        compareAtPrice: price.compareAt,
        lineTotal: price.unit * item.quantity,
        level,
        problem,
      },
    };
  });
}

async function branchInfo(id: Types.ObjectId | null | undefined) {
  if (!id) return null;
  const b = await Branch.findById(id).select('name code status settings').lean();
  return b && b.status === 'active' ? b : null;
}

export async function cartDto(cart: CartDoc | null): Promise<CartDto> {
  if (!cart) return { branch: null, lines: [], itemCount: 0, subtotal: 0 };
  const branch = await branchInfo(cart.branch);
  const lines = await resolveLines({ items: cart.items, branch: branch?._id ?? null }, branch?.name);
  return {
    branch: branch ? { id: branch._id.toString(), name: branch.name, code: branch.code, pickup: branch.settings.pickupEnabled, delivery: branch.settings.deliveryEnabled } : null,
    lines: lines.map((l) => l.dto),
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    subtotal: lines.reduce((n, l) => n + l.dto.lineTotal, 0),
  };
}

export async function getCart(owner: CartOwner): Promise<CartDto> {
  return cartDto(await findCart(owner));
}

// ------------------------------------------------------------------ mutations

export async function setCartItem(owner: CartOwner, input: z.output<typeof cartItemSchema>): Promise<CartDto> {
  const product = await Product.findById(input.product).select('status hasVariants variants').lean();
  if (input.quantity > 0) {
    if (!product || product.status !== 'active') throw notFound('Product');
    if (product.hasVariants) {
      const v = input.variantId ? product.variants.find((x) => x._id.equals(input.variantId!)) : null;
      if (!v || v.status !== 'active') throw badRequest('Choose an available size or colour.', { variantId: ['Required'] });
    } else if (input.variantId) {
      throw badRequest('This product has no options.');
    }
  }
  const cart = await getOrCreateCart(owner);
  const idx = cart.items.findIndex((i) => i.product.equals(input.product) && String(i.variantId ?? '') === String(input.variantId ?? ''));
  if (input.quantity === 0) {
    if (idx >= 0) cart.items.splice(idx, 1);
  } else if (idx >= 0) {
    cart.items[idx]!.quantity = input.quantity;
  } else {
    if (cart.items.length >= MAX_LINES) throw badRequest(`A cart can hold up to ${MAX_LINES} different items.`);
    cart.items.push({ product: new Types.ObjectId(input.product), variantId: input.variantId ? new Types.ObjectId(input.variantId) : null, quantity: input.quantity, addedAt: new Date() });
  }
  touch(cart, owner);
  await cart.save();
  return cartDto(cart);
}

export async function setCartBranch(owner: CartOwner, branchId: string): Promise<CartDto> {
  const branch = await Branch.findOne({ _id: branchId, status: 'active' }).select('_id').lean();
  if (!branch) throw badRequest('Choose one of our active branches.');
  const cart = await getOrCreateCart(owner);
  cart.branch = branch._id;
  touch(cart, owner);
  await cart.save();
  return cartDto(cart);
}

export async function clearCart(owner: CartOwner): Promise<void> {
  const cart = await findCart(owner);
  if (cart) {
    cart.items.splice(0);
    await cart.save();
  }
}

/** After sign-in, move the guest cart into the account cart (quantities add up, max 100 each). */
export async function mergeGuestCart(userId: string, guestToken: string | null | undefined): Promise<CartDto> {
  const guest = guestToken ? await Cart.findOne({ guestTokenHash: hashToken(guestToken) }) : null;
  const cart = await getOrCreateCart({ userId });
  if (guest) {
    for (const g of guest.items) {
      const existing = cart.items.find((i) => i.product.equals(g.product) && String(i.variantId ?? '') === String(g.variantId ?? ''));
      if (existing) existing.quantity = Math.min(100, existing.quantity + g.quantity);
      else if (cart.items.length < MAX_LINES) cart.items.push(g);
    }
    if (!cart.branch && guest.branch) cart.branch = guest.branch;
    await cart.save();
    await guest.deleteOne();
  }
  return cartDto(cart);
}

// ------------------------------------------------------------------ quote

export interface QuoteResult {
  dto: QuoteDto;
  cart: CartDoc | null;
  lines: ResolvedLine[];
  branch: NonNullable<Awaited<ReturnType<typeof branchInfo>>> | null;
  promotion: PromotionResult | null;
  zone: { _id: Types.ObjectId; name: string } | null;
}

export async function quote(owner: CartOwner, input: z.output<typeof quoteSchema>, customerId: Types.ObjectId | null): Promise<QuoteResult> {
  const cart = await findCart(owner);
  const problems: string[] = [];
  const branch = await branchInfo(cart?.branch);
  const lines = cart ? await resolveLines({ items: cart.items, branch: branch?._id ?? null }, branch?.name) : [];
  if (!lines.length) problems.push('Your cart is empty.');
  if (!branch) problems.push('Choose the branch you want to order from.');
  for (const l of lines) if (l.dto.problem) problems.push(`${l.dto.product.name}${l.dto.variant ? ` (${l.dto.variant.label})` : ''}: ${l.dto.problem}`);

  if (branch && input.fulfilment === 'pickup' && !branch.settings.pickupEnabled) problems.push(`${branch.name} does not offer pickup. Choose delivery or another branch.`);
  if (branch && input.fulfilment === 'delivery' && !branch.settings.deliveryEnabled) problems.push(`${branch.name} does not deliver. Choose pickup or another branch.`);

  const subtotal = lines.reduce((n, l) => n + l.dto.lineTotal, 0);
  let zone: QuoteResult['zone'] = null;
  let deliveryFee = 0;
  let zoneInfo: QuoteDto['deliveryZone'] = null;
  if (input.fulfilment === 'delivery' && input.deliveryZone) {
    const z = await DeliveryZone.findOne({ _id: input.deliveryZone, status: 'active' }).lean();
    if (!z || !branch || !z.branch.equals(branch._id)) problems.push('Choose a delivery area served by this branch.');
    else {
      zone = { _id: z._id, name: z.name };
      zoneInfo = { id: z._id.toString(), name: z.name, estimatedDays: z.estimatedDays };
      deliveryFee = z.freeAbove != null && subtotal >= z.freeAbove ? 0 : z.fee;
    }
  }

  let promotion: PromotionResult | null = null;
  let promoMessage: string | null = null;
  if (branch && lines.length) {
    const priced: PricedLine[] = lines
      .filter((l) => l.product)
      .map((l) => ({ product: l.product!._id, categoryPath: l.product!.categoryPath, brand: l.product!.brand ?? null, lineTotal: l.dto.lineTotal }));
    const chosen = await choosePromotion(input.promoCode, { lines: priced, subtotal, branch: branch._id, customerId, deliveryFee });
    promotion = chosen.result;
    promoMessage = chosen.message;
  }
  const discount = promotion?.discount ?? 0;
  if (promotion?.freeDelivery) deliveryFee = 0;

  return {
    cart,
    lines,
    branch,
    promotion,
    zone,
    dto: {
      lines: lines.map((l) => l.dto),
      subtotal,
      discount,
      deliveryFee,
      total: Math.max(0, subtotal - discount + deliveryFee),
      promotion: promotion ? { id: promotion.promotion._id.toString(), name: promotion.promotion.name, code: promotion.promotion.code ?? null } : null,
      promoMessage,
      deliveryZone: zoneInfo,
      problems,
    },
  };
}
