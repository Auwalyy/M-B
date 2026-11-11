import {
  type OrderDto,
  type OrderStatus,
  type OrderTrackingDto,
  PERMISSIONS,
  type checkoutSchema,
  type listOrdersQuery,
} from '@mb/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { env } from '../../config/env';
import type { AuthContext } from '../../core/auth/AuthContext';
import { nextReference } from '../../core/db/counter';
import { withTransaction } from '../../core/db/transaction';
import { AppError, conflict, forbidden, notFound } from '../../core/errors/AppError';
import { Page, escapeRegex, skipFor } from '../../core/http/pagination';
import type { RequestMeta } from '../../core/http/route';
import { queueEmail } from '../../core/mail/mailer';
import { newOrderStaffEmail, orderPlacedEmail } from '../../core/mail/templates';
import { audit } from '../audit/audit.service';
import { variantLabel } from '../catalog/catalog.models';
import { Customer } from '../customers/customer.model';
import { markServed } from '../customers/customer.service';
import { CustomerInteraction } from '../customers/crm.models';
import { applyReservation } from '../inventory/inventory.service';
import { getSettingsDoc } from '../settings/settings.service';
import { User } from '../users/user.model';
import { type CartOwner, quote } from './cart.service';
import { type IOrder, Order, type OrderDoc, Promotion } from './commerce.models';

const P = PERMISSIONS;
/** Customers may cancel online orders until the branch starts preparing them. */
const CUSTOMER_CANCELLABLE: OrderStatus[] = ['pending'];
const STAFF_CANCELLABLE: OrderStatus[] = ['pending', 'confirmed', 'processing', 'ready_for_pickup'];

type BranchLite = { _id: Types.ObjectId; name: string; code: string; phone: string; whatsapp: string; address: string; city: string };
type Populated = Omit<IOrder, 'branch' | 'customer'> & { _id: Types.ObjectId; branch: BranchLite; customer: { _id: Types.ObjectId; fullName: string; phone: string; email?: string } };

function orderDto(o: Populated, canCancel: boolean): OrderDto {
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
    canCancel,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

const POP = [
  { path: 'branch', select: 'name code phone whatsapp address city' },
  { path: 'customer', select: 'fullName phone email' },
];

async function load(id: Types.ObjectId | string): Promise<Populated> {
  const o = await Order.findById(id).populate(POP).lean<Populated>();
  if (!o) throw notFound('Order');
  return o;
}

// ------------------------------------------------------------------ placing an order

export async function placeOrder(owner: CartOwner, auth: AuthContext | null, input: z.output<typeof checkoutSchema>, meta: RequestMeta): Promise<OrderDto> {
  // A retried submit returns the order already created.
  const existing = await Order.findOne({ idempotencyKey: input.idempotencyKey }).select('_id user contact').lean();
  if (existing) {
    const same = auth ? existing.user?.toString() === auth.userId : existing.contact.phone === input.contact.phone;
    if (!same) throw conflict('Duplicate checkout key.', undefined, 'IDEMPOTENCY_CONFLICT');
    return orderDto(await load(existing._id), true);
  }
  const settings = await getSettingsDoc();
  if (!auth && !settings.guestCheckoutEnabled) throw new AppError(401, 'SIGN_IN_REQUIRED', 'Please sign in or create an account to place an order.');

  const id = await withTransaction(async () => {
    // Identify the customer: the signed-in account, else the central record for this phone.
    let customerId = auth?.customerId ? new Types.ObjectId(auth.customerId) : null;
    if (!customerId) {
      const known = await Customer.findOne({ phone: input.contact.phone }).select('_id').lean();
      customerId = known?._id ?? null;
    }

    const q = await quote(owner, input, customerId);
    if (q.dto.problems.length) {
      throw new AppError(409, 'CHECKOUT_PROBLEMS', q.dto.problems[0]!, { problems: q.dto.problems });
    }
    if (input.promoCode && !q.promotion) throw new AppError(409, 'PROMO_INVALID', q.dto.promoMessage ?? 'That promo code cannot be used.');
    const branch = q.branch!;

    if (!customerId) {
      // The email stays on the order either way; it goes on the new customer record only if unused.
      const emailFree = input.contact.email ? !(await Customer.exists({ email: input.contact.email })) : false;
      const [c] = await Customer.create([
        {
          fullName: input.contact.fullName,
          phone: input.contact.phone,
          ...(emailFree ? { email: input.contact.email } : {}),
          source: auth ? 'online' : 'guest_checkout',
          branchesServed: [branch._id],
          preferredBranch: branch._id,
        },
      ]);
      customerId = c!._id;
    } else {
      await markServed(customerId, branch._id);
      // Fill in a missing email, but never one another customer uses (a failed write would abort the order).
      if (input.contact.email && !(await Customer.exists({ email: input.contact.email }))) {
        await Customer.updateOne({ _id: customerId, email: { $exists: false } }, { $set: { email: input.contact.email } });
      }
    }

    const orderId = new Types.ObjectId();
    const reference = await nextReference('ORD', branch.code);
    for (const l of q.lines) {
      await applyReservation({
        branch: branch._id,
        product: l.product!._id,
        variantId: l.variant?._id ?? null,
        sku: l.variant?.sku ?? l.product!.sku,
        delta: l.quantity,
        reference: { kind: 'Order', id: orderId, label: reference },
        reason: 'Online order',
        performedBy: auth?.userId ?? null,
        lowStockDefault: settings.lowStockDefault,
      });
    }

    if (q.promotion) {
      // Count the use atomically, so a limited promotion is never over-used.
      const claimed = await Promotion.findOneAndUpdate(
        { _id: q.promotion.promotion._id, $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] },
        { $inc: { usedCount: 1 } },
      );
      if (!claimed) throw conflict('This promotion has just been fully used. Remove the code to continue.', undefined, 'PROMO_EXHAUSTED');
    }

    const now = new Date();
    await Order.create([
      {
        _id: orderId,
        reference,
        channel: 'online',
        customer: customerId,
        contact: { fullName: input.contact.fullName, phone: input.contact.phone, email: input.contact.email ?? null },
        branch: branch._id,
        items: q.lines.map((l) => ({
          product: l.product!._id,
          variantId: l.variant?._id ?? null,
          sku: l.variant?.sku ?? l.product!.sku,
          name: l.product!.name,
          variantLabel: l.variant ? variantLabel(l.variant) : null,
          slug: l.product!.slug,
          image: l.product!.images[0]?.url ?? null,
          unitPrice: l.dto.unitPrice,
          quantity: l.quantity,
          lineTotal: l.dto.lineTotal,
        })),
        subtotal: q.dto.subtotal,
        discountTotal: q.dto.discount,
        deliveryFee: q.dto.deliveryFee,
        total: q.dto.total,
        promotion: q.promotion ? { id: q.promotion.promotion._id, name: q.promotion.promotion.name, code: q.promotion.promotion.code ?? null, discount: q.dto.discount } : null,
        fulfilment: {
          method: input.fulfilment,
          zone: q.zone?._id ?? null,
          zoneName: q.zone?.name ?? null,
          address: input.fulfilment === 'delivery' ? input.deliveryAddress : null,
        },
        paymentMethod: input.paymentMethod,
        status: 'pending',
        statusHistory: [{ from: null, to: 'pending', by: auth?.userId ?? null, at: now, note: 'Order placed online' }],
        note: input.note ?? null,
        idempotencyKey: input.idempotencyKey,
        user: auth?.userId ?? null,
      },
    ]);
    q.cart!.items.splice(0);
    await q.cart!.save();

    await CustomerInteraction.create([{ customer: customerId, branch: branch._id, channel: 'system', direction: 'inbound', summary: `Placed online order ${reference}`, relatedTo: { kind: 'Order', id: orderId, label: reference } }]);
    const trackLink = `${env.WEB_URL}/track?reference=${encodeURIComponent(reference)}`;
    if (input.contact.email) {
      await queueEmail(orderPlacedEmail(input.contact.email, input.contact.fullName, { reference, branch: branch.name, total: q.dto.total, fulfilment: input.fulfilment, link: trackLink }));
    }
    const staff = await User.find({ roleKey: 'BRANCH_ADMIN', status: 'active', branches: branch._id, email: { $type: 'string' } }).select('email fullName').lean();
    for (const s of staff) {
      await queueEmail(newOrderStaffEmail(s.email!, s.fullName, { reference, branch: branch.name, customer: input.contact.fullName, total: q.dto.total, fulfilment: input.fulfilment, link: `${env.WEB_URL}/admin/orders/${orderId}` }));
    }
    await audit({ action: 'order.placed', actor: auth, branch: branch._id, entity: { kind: 'Order', id: orderId, label: reference }, meta: { total: q.dto.total, items: q.lines.length, channel: 'online' } }, meta);
    return orderId;
  });
  return orderDto(await load(id), true);
}

// ------------------------------------------------------------------ cancellation (releases held stock)

async function cancel(order: OrderDoc, by: string | null, note: string, meta: RequestMeta, actor: AuthContext | null) {
  const settings = await getSettingsDoc();
  for (const i of order.items) {
    await applyReservation({
      branch: order.branch,
      product: i.product,
      variantId: i.variantId,
      sku: i.sku,
      delta: -i.quantity,
      reference: { kind: 'Order', id: order._id, label: order.reference },
      reason: 'Order cancelled',
      performedBy: by,
      lowStockDefault: settings.lowStockDefault,
    });
  }
  if (order.promotion?.id) await Promotion.updateOne({ _id: order.promotion.id, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
  order.statusHistory.push({ from: order.status, to: 'cancelled', by: by ? new Types.ObjectId(by) : null, at: new Date(), note });
  order.status = 'cancelled';
  order.cancelledAt = new Date();
  await order.save(); // optimistic concurrency guards against a parallel status change
  await audit({ action: 'order.cancelled', actor, branch: order.branch, entity: { kind: 'Order', id: order._id, label: order.reference }, meta: { note } }, meta);
}

// ------------------------------------------------------------------ customer views

export async function listMyOrders(auth: AuthContext, page = 1, limit = 20): Promise<Page<OrderDto>> {
  const filter = { $or: [{ user: new Types.ObjectId(auth.userId) }, ...(auth.customerId ? [{ customer: new Types.ObjectId(auth.customerId) }] : [])] };
  const [rows, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skipFor(page, limit)).limit(limit).populate(POP).lean<Populated[]>(),
    Order.countDocuments(filter),
  ]);
  return Page.of(rows.map((o) => orderDto(o, CUSTOMER_CANCELLABLE.includes(o.status))), total, page, limit);
}

function isMine(auth: AuthContext, o: Pick<IOrder, 'user' | 'customer'>) {
  return o.user?.toString() === auth.userId || (auth.customerId !== null && o.customer.toString() === auth.customerId);
}

export async function getMyOrder(auth: AuthContext, reference: string): Promise<OrderDto> {
  const o = await Order.findOne({ reference }).populate(POP).lean<Populated>();
  if (!o || !isMine(auth, { user: o.user, customer: o.customer._id })) throw notFound('Order');
  return orderDto(o, CUSTOMER_CANCELLABLE.includes(o.status));
}

export async function cancelMyOrder(auth: AuthContext, reference: string, reason: string | undefined, meta: RequestMeta): Promise<OrderDto> {
  const id = await withTransaction(async () => {
    const o = await Order.findOne({ reference });
    if (!o || !isMine(auth, o)) throw notFound('Order');
    if (!CUSTOMER_CANCELLABLE.includes(o.status)) {
      throw conflict('This order is already being prepared. Please contact the branch to cancel it.', undefined, 'INVALID_STATE');
    }
    await cancel(o, auth.userId, reason ? `Cancelled by customer: ${reason}` : 'Cancelled by customer', meta, auth);
    return o._id;
  });
  return orderDto(await load(id), false);
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

function staffFilter(auth: AuthContext): Record<string, unknown> {
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
  return Page.of(rows.map((o) => orderDto(o, STAFF_CANCELLABLE.includes(o.status) && auth.canAccessBranch(P.ORDERS_CANCEL, o.branch._id))), total, q.page, q.limit);
}

export async function getOrder(auth: AuthContext, id: string): Promise<OrderDto> {
  const o = await Order.findOne({ _id: id, ...staffFilter(auth) }).populate(POP).lean<Populated>();
  if (!o) throw notFound('Order');
  return orderDto(o, STAFF_CANCELLABLE.includes(o.status) && auth.canAccessBranch(P.ORDERS_CANCEL, o.branch._id));
}

export async function staffCancelOrder(auth: AuthContext, id: string, reason: string | undefined, meta: RequestMeta): Promise<OrderDto> {
  await withTransaction(async () => {
    const o = await Order.findOne({ _id: id, ...staffFilter(auth) });
    if (!o) throw notFound('Order');
    if (!auth.canAccessBranch(P.ORDERS_CANCEL, o.branch)) throw forbidden();
    if (!STAFF_CANCELLABLE.includes(o.status)) throw conflict(`A ${o.status.replace(/_/g, ' ')} order cannot be cancelled.`, undefined, 'INVALID_STATE');
    await cancel(o, auth.userId, reason ? `Cancelled by staff: ${reason}` : 'Cancelled by staff', meta, auth);
  });
  return getOrder(auth, id);
}

