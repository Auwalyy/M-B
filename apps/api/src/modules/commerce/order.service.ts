import {
  ORDER_CANCELLABLE,
  ORDER_TRANSITIONS,
  type OrderDto,
  type OrderStatus,
  type OrderTrackingDto,
  PERMISSIONS,
  type checkoutSchema,
  type listOrdersQuery,
  type staffOrderSchema,
} from '@mb/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { env } from '../../config/env';
import type { AuthContext } from '../../core/auth/AuthContext';
import { nextReference } from '../../core/db/counter';
import { withTransaction } from '../../core/db/transaction';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../core/errors/AppError';
import { Page, escapeRegex, skipFor } from '../../core/http/pagination';
import type { RequestMeta } from '../../core/http/route';
import { audit } from '../audit/audit.service';
import { variantLabel } from '../catalog/catalog.models';
import { Customer } from '../customers/customer.model';
import { markServed } from '../customers/customer.service';
import { CustomerInteraction, Enquiry } from '../customers/crm.models';
import { applyReservation } from '../inventory/inventory.service';
import { notifyBranchTeam, notifyCustomer } from '../notifications/notification.service';
import { getSettingsDoc } from '../settings/settings.service';
import { Delivery, Payment } from '../transactions/transactions.models';
import { type CartOwner, type ResolvedLine, priceItems, quote } from './cart.service';
import { type IOrder, Order, type OrderDoc, Promotion } from './commerce.models';
import { STATUS_TEXT, applyTransition, cancelOrderDoc, outstandingOf } from './order-workflow';

const P = PERMISSIONS;
const CUSTOMER_CANCELLABLE: OrderStatus[] = ['pending'];

type BranchLite = { _id: Types.ObjectId; name: string; code: string; phone: string; whatsapp: string; address: string; city: string };
type Populated = Omit<IOrder, 'branch' | 'customer'> & { _id: Types.ObjectId; branch: BranchLite; customer: { _id: Types.ObjectId; fullName: string; phone: string; email?: string } };

interface Extras {
  canCancel: boolean;
  allowedTransitions: OrderStatus[];
}

async function orderDto(o: Populated, extras: Extras): Promise<OrderDto> {
  const [payments, delivery] = await Promise.all([
    Payment.find({ order: o._id, status: { $in: ['pending', 'success'] } }).sort({ createdAt: 1 }).lean(),
    o.fulfilment.method === 'delivery' ? Delivery.findOne({ order: o._id }).lean() : Promise.resolve(null),
  ]);
  return {
    id: o._id.toString(),
    reference: o.reference,
    channel: o.channel,
    status: o.status,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    branch: { id: o.branch._id.toString(), name: o.branch.name, code: o.branch.code, phone: o.branch.phone, whatsapp: o.branch.whatsapp, address: `${o.branch.address}, ${o.branch.city}` },
    customer: { id: o.customer._id.toString(), fullName: o.contact.fullName, phone: o.contact.phone, email: o.contact.email ?? null },
    items: o.items.map((i) => ({
      product: { id: i.product.toString(), name: i.name, slug: i.slug, sku: i.sku, image: i.image ?? null },
      variant: i.variantId ? { id: i.variantId.toString(), label: i.variantLabel ?? '' } : null,
      sku: i.sku,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    subtotal: o.subtotal,
    discountTotal: o.discountTotal,
    deliveryFee: o.deliveryFee,
    total: o.total,
    amountPaid: o.amountPaid,
    outstanding: outstandingOf(o),
    payments: payments.map((p) => ({
      id: p._id.toString(),
      reference: p.reference,
      method: p.method,
      amount: p.amount,
      status: p.status,
      receiptNumber: p.receiptNumber ?? null,
      refundedAmount: p.refunds.filter((r) => r.status !== 'failed').reduce((n, r) => n + r.amount, 0),
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
    })),
    delivery: delivery ? { id: delivery._id.toString(), status: delivery.status, assignedTo: delivery.assignedTo?.name ? { name: delivery.assignedTo.name, phone: delivery.assignedTo.phone } : null } : null,
    allowedTransitions: extras.allowedTransitions,
    createdBy: o.createdBy?.toString() ?? null,
    promotion: o.promotion?.name ? { name: o.promotion.name, code: o.promotion.code ?? null } : null,
    fulfilment: {
      method: o.fulfilment.method,
      zone: o.fulfilment.zone ? { id: o.fulfilment.zone.toString(), name: o.fulfilment.zoneName ?? '' } : null,
      address: o.fulfilment.address?.line1
        ? { line1: o.fulfilment.address.line1, area: o.fulfilment.address.area ?? null, city: o.fulfilment.address.city, state: o.fulfilment.address.state, landmark: o.fulfilment.address.landmark ?? null }
        : null,
    },
    note: o.note ?? null,
    statusHistory: o.statusHistory.map((h) => ({ from: h.from, to: h.to, at: h.at.toISOString(), by: h.by ? 'staff' : null, note: h.note ?? null })),
    canCancel: extras.canCancel,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

const POP = [
  { path: 'branch', select: 'name code phone whatsapp address city' },
  { path: 'customer', select: 'fullName phone email' },
];

async function loadPopulated(id: Types.ObjectId | string): Promise<Populated> {
  const o = await Order.findById(id).populate(POP).lean<Populated>();
  if (!o) throw notFound('Order');
  return o;
}

const staffExtras = (auth: AuthContext, o: { status: OrderStatus; branch: Types.ObjectId | { _id: Types.ObjectId } }): Extras => {
  const branchId = o.branch instanceof Types.ObjectId ? o.branch : o.branch._id;
  return {
    canCancel: ORDER_CANCELLABLE.includes(o.status) && auth.canAccessBranch(P.ORDERS_CANCEL, branchId),
    allowedTransitions: auth.canAccessBranch(P.ORDERS_UPDATE_STATUS, branchId) ? ORDER_TRANSITIONS[o.status] : [],
  };
};
const customerExtras = (o: Pick<IOrder, 'status'>): Extras => ({ canCancel: CUSTOMER_CANCELLABLE.includes(o.status), allowedTransitions: [] });

// ------------------------------------------------------------------ creating orders (shared)

export interface NewOrderParams {
  orderId?: Types.ObjectId;
  channel: IOrder['channel'];
  status: 'pending' | 'confirmed';
  branch: { _id: Types.ObjectId; code: string; name: string };
  customerId: Types.ObjectId;
  contact: { fullName: string; phone: string; email?: string | null };
  lines: { product: { _id: Types.ObjectId; name: string; slug: string; sku: string; images: { url: string }[] }; variant: { _id: Types.ObjectId; sku: string; size?: string; color?: string } | null; quantity: number; unitPrice: number }[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  promotion: { id: Types.ObjectId; name: string; code?: string | null } | null;
  fulfilment: { method: 'pickup' | 'delivery'; zone?: { _id: Types.ObjectId; name: string } | null; address?: IOrder['fulfilment']['address'] };
  paymentMethod: IOrder['paymentMethod'];
  note?: string | null;
  idempotencyKey?: string | null;
  userId?: string | null;
  createdBy?: string | null;
  /** Hold stock for each line (false when converting a reservation, which already holds it). */
  holdStock: boolean;
  historyNote: string;
}

/** Writes the order, holds stock, counts promotion use and creates the delivery record. Call inside a transaction. */
export async function createOrderRecord(p: NewOrderParams): Promise<OrderDoc> {
  const settings = await getSettingsDoc();
  const orderId = p.orderId ?? new Types.ObjectId();
  const reference = await nextReference('ORD', p.branch.code);
  if (p.holdStock) {
    for (const l of p.lines) {
      await applyReservation({
        branch: p.branch._id, product: l.product._id, variantId: l.variant?._id ?? null, sku: l.variant?.sku ?? l.product.sku, delta: l.quantity,
        reference: { kind: 'Order', id: orderId, label: reference }, reason: p.historyNote, performedBy: p.createdBy ?? p.userId ?? null, lowStockDefault: settings.lowStockDefault,
      });
    }
  }
  if (p.promotion) {
    // Count the use atomically, so a limited promotion is never over-used.
    const claimed = await Promotion.findOneAndUpdate({ _id: p.promotion.id, $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] }, { $inc: { usedCount: 1 } });
    if (!claimed) throw conflict('This promotion has just been fully used. Remove the code to continue.', undefined, 'PROMO_EXHAUSTED');
  }
  const now = new Date();
  const total = Math.max(0, p.subtotal - p.discount + p.deliveryFee);
  const [order] = await Order.create([
    {
      _id: orderId,
      reference,
      channel: p.channel,
      customer: p.customerId,
      contact: { fullName: p.contact.fullName, phone: p.contact.phone, email: p.contact.email ?? null },
      branch: p.branch._id,
      items: p.lines.map((l) => ({
        product: l.product._id, variantId: l.variant?._id ?? null, sku: l.variant?.sku ?? l.product.sku, name: l.product.name,
        variantLabel: l.variant ? variantLabel(l.variant) : null, slug: l.product.slug, image: l.product.images[0]?.url ?? null,
        unitPrice: l.unitPrice, quantity: l.quantity, lineTotal: l.unitPrice * l.quantity,
      })),
      subtotal: p.subtotal,
      discountTotal: p.discount,
      deliveryFee: p.deliveryFee,
      total,
      promotion: p.promotion ? { ...p.promotion, discount: p.discount } : null,
      fulfilment: { method: p.fulfilment.method, zone: p.fulfilment.zone?._id ?? null, zoneName: p.fulfilment.zone?.name ?? null, address: p.fulfilment.method === 'delivery' ? p.fulfilment.address : null },
      paymentMethod: p.paymentMethod,
      status: p.status,
      statusHistory: [
        { from: null, to: 'pending', by: p.createdBy ?? p.userId ?? null, at: now, note: p.historyNote },
        ...(p.status === 'confirmed' ? [{ from: 'pending' as const, to: 'confirmed' as const, by: p.createdBy ?? null, at: now, note: null }] : []),
      ],
      confirmedAt: p.status === 'confirmed' ? now : null,
      note: p.note ?? null,
      idempotencyKey: p.idempotencyKey ?? null,
      user: p.userId ?? null,
      createdBy: p.createdBy ?? null,
    },
  ]);
  if (p.fulfilment.method === 'delivery' && p.fulfilment.address) {
    await Delivery.create([
      {
        order: orderId, branch: p.branch._id, address: p.fulfilment.address, contact: { fullName: p.contact.fullName, phone: p.contact.phone },
        zoneName: p.fulfilment.zone?.name ?? null, fee: p.deliveryFee, status: 'pending', history: [{ status: 'pending', by: null, at: now, note: null }],
      },
    ]);
  }
  await markServed(p.customerId, p.branch._id);
  await CustomerInteraction.create([{ customer: p.customerId, branch: p.branch._id, channel: 'system', direction: 'inbound', summary: `${p.channel === 'online' ? 'Placed online' : 'Order'} ${reference}`, relatedTo: { kind: 'Order', id: orderId, label: reference }, recordedBy: p.createdBy ?? null }]);
  return order!;
}

/** Finds the central customer by phone, or creates one. Never sets an email another customer uses. */
export async function findOrCreateCustomer(contact: { fullName: string; phone: string; email?: string | null }, source: 'online' | 'guest_checkout' | 'walk_in' | 'phone' | 'whatsapp', branchId: Types.ObjectId, registeredBy?: string | null): Promise<Types.ObjectId> {
  const known = await Customer.findOne({ phone: contact.phone }).select('_id email').lean();
  const emailFree = contact.email ? !(await Customer.exists({ email: contact.email })) : false;
  if (known) {
    if (contact.email && emailFree && !known.email) await Customer.updateOne({ _id: known._id }, { $set: { email: contact.email } });
    return known._id;
  }
  const [c] = await Customer.create([
    { fullName: contact.fullName, phone: contact.phone, ...(emailFree && contact.email ? { email: contact.email } : {}), source, branchesServed: [branchId], preferredBranch: branchId, ...(registeredBy ? { registeredBy: new Types.ObjectId(registeredBy), registeredAtBranch: branchId } : {}) },
  ]);
  return c!._id;
}

const toNewLines = (lines: ResolvedLine[]) => lines.map((l) => ({ product: l.product!, variant: l.variant, quantity: l.quantity, unitPrice: l.dto.unitPrice }));

// ------------------------------------------------------------------ online checkout

export async function placeOrder(owner: CartOwner, auth: AuthContext | null, input: z.output<typeof checkoutSchema>, meta: RequestMeta): Promise<OrderDto> {
  const existing = await Order.findOne({ idempotencyKey: input.idempotencyKey }).select('_id user contact status').lean();
  if (existing) {
    const same = auth ? existing.user?.toString() === auth.userId : existing.contact.phone === input.contact.phone;
    if (!same) throw conflict('Duplicate checkout key.', undefined, 'IDEMPOTENCY_CONFLICT');
    const o = await loadPopulated(existing._id);
    return orderDto(o, customerExtras(o));
  }
  const settings = await getSettingsDoc();
  if (!auth && !settings.guestCheckoutEnabled) throw new AppError(401, 'SIGN_IN_REQUIRED', 'Please sign in or create an account to place an order.');
  if (input.paymentMethod === 'paystack' && !env.paystackEnabled) throw badRequest('Card payment is not available yet. Choose another payment method.', { paymentMethod: ['Not available'] });

  const id = await withTransaction(async () => {
    let customerId = auth?.customerId ? new Types.ObjectId(auth.customerId) : (await Customer.findOne({ phone: input.contact.phone }).select('_id').lean())?._id ?? null;
    const q = await quote(owner, input, customerId);
    if (q.dto.problems.length) throw new AppError(409, 'CHECKOUT_PROBLEMS', q.dto.problems[0]!, { problems: q.dto.problems });
    if (input.promoCode && !q.promotion) throw new AppError(409, 'PROMO_INVALID', q.dto.promoMessage ?? 'That promo code cannot be used.');
    const branch = q.branch!;
    customerId ??= await findOrCreateCustomer(input.contact, auth ? 'online' : 'guest_checkout', branch._id);

    const order = await createOrderRecord({
      channel: 'online', status: 'pending', branch, customerId, contact: input.contact, lines: toNewLines(q.lines),
      subtotal: q.dto.subtotal, discount: q.dto.discount, deliveryFee: q.dto.deliveryFee,
      promotion: q.promotion ? { id: q.promotion.promotion._id, name: q.promotion.promotion.name, code: q.promotion.promotion.code ?? null } : null,
      fulfilment: { method: input.fulfilment, zone: q.zone, address: input.deliveryAddress }, paymentMethod: input.paymentMethod,
      note: input.note, idempotencyKey: input.idempotencyKey, userId: auth?.userId ?? null, holdStock: true, historyNote: 'Order placed online',
    });
    q.cart!.items.splice(0);
    await q.cart!.save();

    await notifyBranchTeam(branch._id, P.ORDERS_READ_ALL_BRANCH, {
      type: 'order.new', title: `New online order ${order.reference}`, body: `${input.contact.fullName} ordered ${q.lines.length} item(s) for ₦${(order.total / 100).toLocaleString('en-NG')} (${input.fulfilment}).`,
      link: `/admin/orders/${order._id}`, email: true,
    });
    await notifyCustomer(customerId, {
      type: 'order.placed', title: `Order ${order.reference} received`,
      body: `Thank you. We have received your order ${order.reference} for ₦${(order.total / 100).toLocaleString('en-NG')}. ${branch.name} will confirm it shortly.`,
      link: auth ? `/account/orders/${order.reference}` : `/track?reference=${order.reference}`, branch: branch._id, contactEmail: input.contact.email,
    });
    await audit({ action: 'order.placed', actor: auth, branch: branch._id, entity: { kind: 'Order', id: order._id, label: order.reference }, meta: { total: order.total, channel: 'online' } }, meta);
    return order._id;
  });
  const o = await loadPopulated(id);
  return orderDto(o, customerExtras(o));
}

// ------------------------------------------------------------------ staff orders (in store, phone, WhatsApp)

export async function createStaffOrder(auth: AuthContext, input: z.output<typeof staffOrderSchema>, meta: RequestMeta): Promise<OrderDto> {
  if (!auth.canAccessBranch(P.ORDERS_CREATE, input.branch)) throw forbidden('You can only create orders for your own branches.');
  const existing = await Order.findOne({ idempotencyKey: input.idempotencyKey }).select('_id createdBy').lean();
  if (existing) {
    if (existing.createdBy?.toString() !== auth.userId) throw conflict('Duplicate request key.', undefined, 'IDEMPOTENCY_CONFLICT');
    return getOrder(auth, existing._id.toString());
  }
  const id = await withTransaction(async () => {
    let contact = input.contact;
    let customerId: Types.ObjectId | null = null;
    if (input.customer) {
      const c = await Customer.findById(input.customer).select('fullName phone email').lean();
      if (!c) throw badRequest('Customer not found.', { customer: ['Not found'] });
      customerId = c._id;
      contact = { fullName: c.fullName, phone: c.phone, email: c.email };
    }
    const branchId = new Types.ObjectId(input.branch);
    const priced = await priceItems(
      input.items.map((i) => ({ product: new Types.ObjectId(i.product), variantId: i.variantId ? new Types.ObjectId(i.variantId) : null, quantity: i.quantity, addedAt: new Date() })),
      branchId,
      { fulfilment: input.fulfilment, deliveryZone: input.deliveryZone, promoCode: input.promoCode },
      customerId,
    );
    if (priced.dto.problems.length) throw new AppError(409, 'CHECKOUT_PROBLEMS', priced.dto.problems[0]!, { problems: priced.dto.problems });
    if (input.promoCode && !priced.promotion) throw new AppError(409, 'PROMO_INVALID', priced.dto.promoMessage ?? 'That promo code cannot be used.');
    customerId ??= await findOrCreateCustomer(contact!, input.channel === 'in_store' ? 'walk_in' : input.channel, branchId, auth.userId);

    const order = await createOrderRecord({
      channel: input.channel, status: 'confirmed', branch: priced.branch!, customerId, contact: contact!, lines: toNewLines(priced.lines),
      subtotal: priced.dto.subtotal, discount: priced.dto.discount, deliveryFee: priced.dto.deliveryFee,
      promotion: priced.promotion ? { id: priced.promotion.promotion._id, name: priced.promotion.promotion.name, code: priced.promotion.promotion.code ?? null } : null,
      fulfilment: { method: input.fulfilment, zone: priced.zone, address: input.deliveryAddress }, paymentMethod: input.paymentMethod,
      note: input.note, idempotencyKey: input.idempotencyKey, createdBy: auth.userId, holdStock: true, historyNote: `Created by staff (${input.channel.replace('_', ' ')})`,
    });
    if (input.enquiry) {
      await Enquiry.updateOne({ _id: input.enquiry, branch: branchId }, { $set: { status: 'converted' }, $push: { notes: { text: `Converted to order ${order.reference}`, by: new Types.ObjectId(auth.userId), at: new Date() } } });
    }
    await audit({ action: 'order.created_by_staff', actor: auth, branch: branchId, entity: { kind: 'Order', id: order._id, label: order.reference }, meta: { total: order.total, channel: input.channel } }, meta);
    return order._id;
  });
  return getOrder(auth, id.toString());
}

// ------------------------------------------------------------------ workflow

export async function transitionOrder(auth: AuthContext, id: string, to: OrderStatus, note: string | undefined, meta: RequestMeta): Promise<OrderDto> {
  await withTransaction(async () => {
    const o = await Order.findOne({ _id: id, ...staffFilter(auth) });
    if (!o) throw notFound('Order');
    if (to === 'cancelled' || to === 'refunded') throw badRequest(to === 'cancelled' ? 'Use cancel.' : 'Refunds are made from the payment.');
    if (!auth.canAccessBranch(P.ORDERS_UPDATE_STATUS, o.branch)) throw forbidden();
    const from = o.status;
    await applyTransition(o, to, auth.userId, note);
    await audit({ action: 'order.status_changed', actor: auth, branch: o.branch, entity: { kind: 'Order', id: o._id, label: o.reference }, before: { status: from }, after: { status: to }, meta: note ? { note } : undefined }, meta);
  });
  return getOrder(auth, id);
}

// ------------------------------------------------------------------ customer views

export async function listMyOrders(auth: AuthContext, page = 1, limit = 20): Promise<Page<OrderDto>> {
  const filter = { $or: [{ user: new Types.ObjectId(auth.userId) }, ...(auth.customerId ? [{ customer: new Types.ObjectId(auth.customerId) }] : [])] };
  const [rows, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skipFor(page, limit)).limit(limit).populate(POP).lean<Populated[]>(),
    Order.countDocuments(filter),
  ]);
  return Page.of(await Promise.all(rows.map((o) => orderDto(o, customerExtras(o)))), total, page, limit);
}

export function isMine(auth: AuthContext, o: Pick<IOrder, 'user' | 'customer'>) {
  return o.user?.toString() === auth.userId || (auth.customerId !== null && o.customer.toString() === auth.customerId);
}

export async function getMyOrder(auth: AuthContext, reference: string): Promise<OrderDto> {
  const o = await Order.findOne({ reference }).populate(POP).lean<Populated>();
  if (!o || !isMine(auth, { user: o.user, customer: o.customer._id })) throw notFound('Order');
  return orderDto(o, customerExtras(o));
}

export async function cancelMyOrder(auth: AuthContext, reference: string, reason: string | undefined, meta: RequestMeta): Promise<OrderDto> {
  const id = await withTransaction(async () => {
    const o = await Order.findOne({ reference });
    if (!o || !isMine(auth, o)) throw notFound('Order');
    if (!CUSTOMER_CANCELLABLE.includes(o.status)) throw conflict('This order is already being prepared. Please contact the branch to cancel it.', undefined, 'INVALID_STATE');
    await cancelOrderDoc(o, auth.userId, reason ? `Cancelled by customer: ${reason}` : 'Cancelled by customer');
    await audit({ action: 'order.cancelled', actor: auth, branch: o.branch, entity: { kind: 'Order', id: o._id, label: o.reference }, meta: { by: 'customer', reason } }, meta);
    return o._id;
  });
  const o = await loadPopulated(id);
  return orderDto(o, customerExtras(o));
}

/** Public tracking by order number and the phone number used at checkout. */
export async function trackOrder(reference: string, phone: string): Promise<OrderTrackingDto> {
  const o = await Order.findOne({ reference, 'contact.phone': phone }).populate('branch', 'name phone whatsapp address city').lean<Populated>();
  if (!o) throw notFound('Order');
  return {
    reference: o.reference,
    status: o.status,
    fulfilment: o.fulfilment.method,
    branch: { name: o.branch.name, phone: o.branch.phone, whatsapp: o.branch.whatsapp, address: `${o.branch.address}, ${o.branch.city}` },
    itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
    total: o.total,
    history: o.statusHistory.map((h) => ({ status: h.to, at: h.at.toISOString() })),
    createdAt: o.createdAt.toISOString(),
  };
}

// ------------------------------------------------------------------ staff views

export function staffFilter(auth: AuthContext): Record<string, unknown> {
  // Sales staff see their own transactions unless allowed to see every order of the branch (decision D8).
  const allBranch = auth.isCompanyWide || auth.can(P.ORDERS_READ_ALL_BRANCH);
  return { ...auth.branchFilter(P.ORDERS_READ), ...(allBranch ? {} : { createdBy: new Types.ObjectId(auth.userId) }) };
}

export async function listOrders(auth: AuthContext, q: z.output<typeof listOrdersQuery>): Promise<Page<OrderDto>> {
  const filter: Record<string, unknown> = staffFilter(auth);
  if (q.branch) {
    if (!auth.canAccessBranch(P.ORDERS_READ, q.branch)) return Page.of([], 0, q.page, q.limit);
    filter.branch = new Types.ObjectId(q.branch);
  }
  if (q.status) filter.status = q.status;
  if (q.channel) filter.channel = q.channel;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ reference: rx }, { 'contact.fullName': rx }, { 'contact.phone': rx }];
  }
  const [rows, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).populate(POP).lean<Populated[]>(),
    Order.countDocuments(filter),
  ]);
  return Page.of(await Promise.all(rows.map((o) => orderDto(o, staffExtras(auth, o)))), total, q.page, q.limit);
}

export async function getOrder(auth: AuthContext, id: string): Promise<OrderDto> {
  const o = await Order.findOne({ _id: id, ...staffFilter(auth) }).populate(POP).lean<Populated>();
  if (!o) throw notFound('Order');
  return orderDto(o, staffExtras(auth, o));
}

export async function staffCancelOrder(auth: AuthContext, id: string, reason: string | undefined, meta: RequestMeta): Promise<OrderDto> {
  await withTransaction(async () => {
    const o = await Order.findOne({ _id: id, ...staffFilter(auth) });
    if (!o) throw notFound('Order');
    if (!auth.canAccessBranch(P.ORDERS_CANCEL, o.branch)) throw forbidden();
    await cancelOrderDoc(o, auth.userId, reason ? `Cancelled by staff: ${reason}` : 'Cancelled by staff');
    await audit({ action: 'order.cancelled', actor: auth, branch: o.branch, entity: { kind: 'Order', id: o._id, label: o.reference }, meta: { by: 'staff', reason } }, meta);
  });
  return getOrder(auth, id);
}

// ------------------------------------------------------------------ background job

/**
 * Online orders the branch never confirmed are cancelled after the configured time,
 * so their stock does not stay held forever. Returns how many were cancelled.
 */
export async function expireUnattendedOrders(now = new Date()): Promise<number> {
  const settings = await getSettingsDoc();
  const cutoff = new Date(now.getTime() - settings.pendingOrderExpiryHours * 3_600_000);
  const stale = await Order.find({ status: 'pending', channel: 'online', createdAt: { $lt: cutoff }, amountPaid: 0 }).select('_id').limit(200).lean();
  let n = 0;
  for (const { _id } of stale) {
    try {
      await withTransaction(async () => {
        const o = await Order.findOne({ _id, status: 'pending' });
        if (!o) return;
        await cancelOrderDoc(o, null, `Not confirmed within ${settings.pendingOrderExpiryHours} hours`);
        await audit({ action: 'order.expired', entity: { kind: 'Order', id: o._id, label: o.reference }, branch: o.branch });
      });
      n++;
    } catch {
      // Picked up again on the next run.
    }
  }
  return n;
}

export { STATUS_TEXT };
