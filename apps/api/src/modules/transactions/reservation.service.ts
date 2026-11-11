import {
  type OrderDto,
  PERMISSIONS,
  type ReservationDto,
  type ReservationStatus,
  type ReservationTrackingDto,
  type convertReservationSchema,
  type createReservationSchema,
  type listReservationsQuery,
  type staffReservationSchema,
} from '@mb/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import type { AuthContext } from '../../core/auth/AuthContext';
import { nextReference } from '../../core/db/counter';
import { withTransaction } from '../../core/db/transaction';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../core/errors/AppError';
import { Page, escapeRegex, skipFor } from '../../core/http/pagination';
import type { RequestMeta } from '../../core/http/route';
import { audit } from '../audit/audit.service';
import { Branch } from '../branches/branch.model';
import { priceItems } from '../commerce/cart.service';
import { DeliveryZone } from '../commerce/commerce.models';
import { createOrderRecord, findOrCreateCustomer, getOrder } from '../commerce/order.service';
import { Customer } from '../customers/customer.model';
import { Enquiry } from '../customers/crm.models';
import { applyReservation } from '../inventory/inventory.service';
import { notifyBranchTeam, notifyCustomer } from '../notifications/notification.service';
import { getSettingsDoc } from '../settings/settings.service';
import { type IReservation, Reservation, type ReservationDoc } from './transactions.models';

const P = PERMISSIONS;
const OPEN: ReservationStatus[] = ['pending', 'confirmed'];

type BranchLite = { _id: Types.ObjectId; name: string; code: string; phone: string; whatsapp: string; address: string; city: string };
type Populated = Omit<IReservation, 'branch' | 'customer' | 'convertedOrder'> & {
  _id: Types.ObjectId;
  branch: BranchLite;
  customer: { _id: Types.ObjectId; fullName: string; phone: string; email?: string };
  convertedOrder: { _id: Types.ObjectId; reference: string } | null;
};

function allowed(auth: AuthContext | null, r: Pick<IReservation, 'status' | 'branch' | 'user' | 'customer'>): ReservationDto['allowedActions'] {
  if (!auth) return [];
  const out: ReservationDto['allowedActions'] = [];
  const review = auth.canAccessBranch(P.RESERVATIONS_REVIEW, r.branch);
  if (r.status === 'pending' && review) out.push('confirm', 'reject');
  if (r.status === 'confirmed' && auth.canAccessBranch(P.ORDERS_CREATE, r.branch)) out.push('convert');
  const mine = r.user?.toString() === auth.userId || (auth.customerId !== null && r.customer.toString() === auth.customerId);
  if (OPEN.includes(r.status) && (review || mine)) out.push('cancel');
  return out;
}

function dto(r: Populated, auth: AuthContext | null): ReservationDto {
  return {
    id: r._id.toString(),
    reference: r.reference,
    status: r.status,
    channel: r.channel,
    branch: { id: r.branch._id.toString(), name: r.branch.name, code: r.branch.code, phone: r.branch.phone, whatsapp: r.branch.whatsapp, address: `${r.branch.address}, ${r.branch.city}` },
    customer: { id: r.customer._id.toString(), fullName: r.contact.fullName, phone: r.contact.phone, email: r.contact.email ?? null },
    items: r.items.map((i) => ({
      product: { id: i.product.toString(), name: i.name, slug: i.slug, sku: i.sku, image: i.image ?? null },
      variant: i.variantId ? { id: i.variantId.toString(), label: i.variantLabel ?? '' } : null,
      sku: i.sku,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    })),
    total: r.total,
    note: r.note ?? null,
    rejectionReason: r.rejectionReason ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    convertedOrder: r.convertedOrder ? { id: r.convertedOrder._id.toString(), reference: r.convertedOrder.reference } : null,
    history: r.history.map((h) => ({ status: h.status, at: h.at.toISOString(), note: h.note ?? null })),
    allowedActions: allowed(auth, { ...r, branch: r.branch._id, customer: r.customer._id }),
    createdAt: r.createdAt.toISOString(),
  };
}

const POP = [
  { path: 'branch', select: 'name code phone whatsapp address city' },
  { path: 'customer', select: 'fullName phone email' },
  { path: 'convertedOrder', select: 'reference' },
];

async function load(id: Types.ObjectId | string, auth: AuthContext | null): Promise<ReservationDto> {
  const r = await Reservation.findById(id).populate(POP).lean<Populated>();
  if (!r) throw notFound('Reservation');
  return dto(r, auth);
}

const hours = (h: number) => new Date(Date.now() + h * 3_600_000);

async function releaseHold(r: ReservationDoc, by: string | null, reason: string) {
  const settings = await getSettingsDoc();
  for (const i of r.items) {
    await applyReservation({ branch: r.branch, product: i.product, variantId: i.variantId, sku: i.sku, delta: -i.quantity, reference: { kind: 'Reservation', id: r._id, label: r.reference }, reason, performedBy: by, lowStockDefault: settings.lowStockDefault });
  }
}

function pushStatus(r: ReservationDoc, status: ReservationStatus, by: string | null, note?: string | null) {
  r.status = status;
  r.history.push({ status, by: by ? new Types.ObjectId(by) : null, at: new Date(), note: note ?? null });
}

function tell(r: ReservationDoc, title: string, body: string, status: string) {
  return notifyCustomer(r.customer, {
    type: `reservation.${status}`, title, body, link: r.user ? '/account' : `/track?reference=${r.reference}`, branch: r.branch, contactEmail: r.contact.email,
    whatsapp: { template: 'reservation', params: [r.contact.fullName.split(' ')[0] ?? '', r.reference, status], related: { kind: 'Reservation', id: r._id } },
  });
}

// ------------------------------------------------------------------ creating

interface CreateOptions {
  channel: IReservation['channel'];
  status: 'pending' | 'confirmed';
  createdBy: string | null;
  userId: string | null;
  customerId: Types.ObjectId | null;
}

async function create(input: z.output<typeof createReservationSchema>, opts: CreateOptions): Promise<ReservationDoc> {
  const settings = await getSettingsDoc();
  const branch = await Branch.findOne({ _id: input.branch, status: 'active' }).select('name code settings').lean();
  if (!branch) throw badRequest('Choose one of our active branches.');
  if (!branch.settings.reservationsEnabled) throw badRequest(`${branch.name} is not taking reservations at the moment.`, undefined, 'RESERVATIONS_DISABLED');
  const max = settings.reservation.maxQuantityPerItem;
  if (input.items.some((i) => i.quantity > max)) throw badRequest(`You can reserve up to ${max} of each item.`, { items: [`At most ${max} per item`] });

  const priced = await priceItems(
    input.items.map((i) => ({ product: new Types.ObjectId(i.product), variantId: i.variantId ? new Types.ObjectId(i.variantId) : null, quantity: i.quantity, addedAt: new Date() })),
    branch._id,
    { fulfilment: 'pickup', promoCode: undefined },
    opts.customerId,
  );
  const lineProblems = priced.dto.problems.filter((p) => !/pickup/.test(p));
  if (lineProblems.length) throw new AppError(409, 'RESERVATION_PROBLEMS', lineProblems[0]!, { problems: lineProblems });

  const customerId = opts.customerId ?? (await findOrCreateCustomer(input.contact, opts.userId ? 'online' : opts.channel === 'online' ? 'guest_checkout' : opts.channel === 'in_store' ? 'walk_in' : opts.channel, branch._id, opts.createdBy));
  const id = new Types.ObjectId();
  const reference = await nextReference('RSV', branch.code);
  for (const l of priced.lines) {
    await applyReservation({
      branch: branch._id, product: l.product!._id, variantId: l.variant?._id ?? null, sku: l.variant?.sku ?? l.product!.sku, delta: l.quantity,
      reference: { kind: 'Reservation', id, label: reference }, reason: 'Reservation', performedBy: opts.createdBy ?? opts.userId, lowStockDefault: settings.lowStockDefault,
    });
  }
  const holdHours = opts.status === 'confirmed' ? branch.settings.reservationHoldHours ?? settings.reservation.confirmedHoldHours : settings.reservation.pendingExpiryHours;
  const now = new Date();
  const [r] = await Reservation.create([
    {
      _id: id, reference, channel: opts.channel, customer: customerId, contact: input.contact, branch: branch._id,
      items: priced.lines.map((l) => ({
        product: l.product!._id, variantId: l.variant?._id ?? null, sku: l.variant?.sku ?? l.product!.sku, name: l.product!.name,
        variantLabel: l.dto.variant?.label ?? null, slug: l.product!.slug, image: l.product!.images[0]?.url ?? null, quantity: l.quantity, unitPrice: l.dto.unitPrice,
      })),
      total: priced.dto.subtotal,
      status: opts.status,
      history: [{ status: 'pending', by: opts.createdBy ?? opts.userId, at: now, note: null }, ...(opts.status === 'confirmed' ? [{ status: 'confirmed' as const, by: opts.createdBy, at: now, note: 'Reserved by staff' }] : [])],
      expiresAt: hours(holdHours),
      note: input.note ?? null,
      user: opts.userId,
      createdBy: opts.createdBy,
    },
  ]);
  await Customer.updateOne({ _id: customerId }, { $inc: { 'stats.reservationCount': 1 }, $addToSet: { branchesServed: branch._id } });
  return r!;
}

export async function createReservation(auth: AuthContext | null, input: z.output<typeof createReservationSchema>, meta: RequestMeta): Promise<ReservationDto> {
  const id = await withTransaction(async () => {
    const r = await create(input, { channel: 'online', status: 'pending', createdBy: null, userId: auth?.userId ?? null, customerId: auth?.customerId ? new Types.ObjectId(auth.customerId) : null });
    await notifyBranchTeam(r.branch, P.RESERVATIONS_REVIEW, { type: 'reservation.new', title: `New reservation ${r.reference}`, body: `${r.contact.fullName} wants to reserve ${r.items.length} item(s). Confirm or reject it.`, link: `/admin/reservations/${r._id}`, email: true });
    await tell(r, `Reservation ${r.reference} received`, `We have held your items and the branch will confirm shortly. Your reservation number is ${r.reference}.`, 'received');
    await audit({ action: 'reservation.created', actor: auth, branch: r.branch, entity: { kind: 'Reservation', id: r._id, label: r.reference } }, meta);
    return r._id;
  });
  return load(id, auth);
}

export async function createStaffReservation(auth: AuthContext, input: z.output<typeof staffReservationSchema>, meta: RequestMeta): Promise<ReservationDto> {
  if (!auth.canAccessBranch(P.RESERVATIONS_CREATE, input.branch)) throw forbidden('You can only reserve for your own branches.');
  const id = await withTransaction(async () => {
    const r = await create(input, { channel: input.channel, status: 'confirmed', createdBy: auth.userId, userId: null, customerId: null });
    if (input.enquiry) await Enquiry.updateOne({ _id: input.enquiry, branch: r.branch }, { $set: { status: 'converted' }, $push: { notes: { text: `Converted to reservation ${r.reference}`, by: new Types.ObjectId(auth.userId), at: new Date() } } });
    await tell(r, `Reservation ${r.reference} confirmed`, `Your items are held until ${r.expiresAt!.toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}.`, 'confirmed');
    await audit({ action: 'reservation.created_by_staff', actor: auth, branch: r.branch, entity: { kind: 'Reservation', id: r._id, label: r.reference } }, meta);
    return r._id;
  });
  return load(id, auth);
}

// ------------------------------------------------------------------ actions

async function findForAction(auth: AuthContext, id: string) {
  const r = await Reservation.findById(id);
  if (!r) throw notFound('Reservation');
  const staff = auth.canAccessBranch(P.RESERVATIONS_READ, r.branch);
  const mine = r.user?.toString() === auth.userId || (auth.customerId !== null && r.customer.toString() === auth.customerId);
  if (!staff && !mine) throw notFound('Reservation');
  return r;
}

export async function actOnReservation(auth: AuthContext, id: string, action: 'confirm' | 'reject' | 'cancel', note: string | undefined, meta: RequestMeta): Promise<ReservationDto> {
  await withTransaction(async () => {
    const r = await findForAction(auth, id);
    if (!allowed(auth, r).includes(action)) {
      if (!OPEN.includes(r.status)) throw conflict(`This reservation is already ${r.status}.`, undefined, 'INVALID_STATE');
      throw forbidden();
    }
    if (action === 'confirm') {
      const settings = await getSettingsDoc();
      const branch = await Branch.findById(r.branch).select('settings').lean();
      r.expiresAt = hours(branch?.settings.reservationHoldHours ?? settings.reservation.confirmedHoldHours);
      pushStatus(r, 'confirmed', auth.userId, note);
      await r.save();
      await tell(r, `Reservation ${r.reference} confirmed`, `Your items are ready to collect until ${r.expiresAt.toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}.`, 'confirmed');
    } else {
      if (action === 'reject' && !note) throw badRequest('Give the customer a reason.', { reason: ['Required'] });
      await releaseHold(r, auth.userId, action === 'reject' ? 'Reservation rejected' : 'Reservation cancelled');
      if (action === 'reject') r.rejectionReason = note ?? null;
      pushStatus(r, action === 'reject' ? 'rejected' : 'cancelled', auth.userId, note);
      await r.save();
      await tell(r, `Reservation ${r.reference} ${action === 'reject' ? 'could not be confirmed' : 'cancelled'}`, action === 'reject' ? `Sorry, the branch could not confirm your reservation: ${note}` : `Your reservation ${r.reference} has been cancelled.`, action === 'reject' ? 'rejected' : 'cancelled');
    }
    await audit({ action: `reservation.${action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'cancelled'}`, actor: auth, branch: r.branch, entity: { kind: 'Reservation', id: r._id, label: r.reference }, meta: note ? { note } : undefined }, meta);
  });
  return load(id, auth);
}

/** Turns a confirmed reservation into an order at the reserved prices. The held stock moves to the order. */
export async function convertReservation(auth: AuthContext, id: string, input: z.output<typeof convertReservationSchema>, meta: RequestMeta): Promise<OrderDto> {
  const orderId = await withTransaction(async () => {
    const r = await findForAction(auth, id);
    if (!allowed(auth, r).includes('convert')) throw conflict(r.status === 'confirmed' ? 'You cannot create orders at this branch.' : `Only confirmed reservations can become orders (this one is ${r.status}).`, undefined, 'INVALID_STATE');
    const branch = await Branch.findById(r.branch).select('name code').lean();
    const settings = await getSettingsDoc();

    let zone: { _id: Types.ObjectId; name: string } | null = null;
    let deliveryFee = 0;
    if (input.fulfilment === 'delivery') {
      const z0 = input.deliveryZone ? await DeliveryZone.findOne({ _id: input.deliveryZone, branch: r.branch, status: 'active' }).lean() : null;
      if (!z0 || !input.deliveryAddress) throw badRequest('Choose a delivery area served by this branch and enter the address.');
      zone = { _id: z0._id, name: z0.name };
      deliveryFee = z0.freeAbove != null && r.total >= z0.freeAbove ? 0 : z0.fee;
    }
    const orderId = new Types.ObjectId();
    // Move the hold: release it from the reservation and hold it for the order (net stock unchanged).
    await releaseHold(r, auth.userId, 'Converted to order');
    for (const i of r.items) {
      await applyReservation({ branch: r.branch, product: i.product, variantId: i.variantId, sku: i.sku, delta: i.quantity, reference: { kind: 'Order', id: orderId, label: r.reference }, reason: `From reservation ${r.reference}`, performedBy: auth.userId, lowStockDefault: settings.lowStockDefault });
    }
    const order = await createOrderRecord({
      orderId, channel: r.channel === 'online' ? 'online' : r.channel, status: 'confirmed', branch: branch!, customerId: r.customer, contact: r.contact,
      lines: r.items.map((i) => ({ product: { _id: i.product, name: i.name, slug: i.slug, sku: i.sku, images: i.image ? [{ url: i.image }] : [] }, variant: i.variantId ? { _id: i.variantId, sku: i.sku, size: i.variantLabel ?? undefined } : null, quantity: i.quantity, unitPrice: i.unitPrice })),
      subtotal: r.total, discount: 0, deliveryFee, promotion: null,
      fulfilment: { method: input.fulfilment, zone, address: input.deliveryAddress }, paymentMethod: input.paymentMethod,
      userId: r.user?.toString() ?? null, createdBy: auth.userId, holdStock: false, historyNote: `From reservation ${r.reference}`,
    });
    // Keep the variant label exactly as reserved.
    for (const [idx, i] of r.items.entries()) if (order.items[idx]) order.items[idx]!.variantLabel = i.variantLabel ?? null;
    await order.save();
    r.convertedOrder = orderId;
    pushStatus(r, 'converted', auth.userId, `Order ${order.reference}`);
    await r.save();
    await audit({ action: 'reservation.converted', actor: auth, branch: r.branch, entity: { kind: 'Reservation', id: r._id, label: r.reference }, meta: { order: order.reference } }, meta);
    return orderId;
  });
  return getOrder(auth, orderId.toString());
}

// ------------------------------------------------------------------ reading

export async function listReservations(auth: AuthContext, q: z.output<typeof listReservationsQuery>): Promise<Page<ReservationDto>> {
  const filter: Record<string, unknown> = { ...auth.branchFilter(P.RESERVATIONS_READ) };
  if (q.branch) {
    if (!auth.canAccessBranch(P.RESERVATIONS_READ, q.branch)) return Page.of([], 0, q.page, q.limit);
    filter.branch = new Types.ObjectId(q.branch);
  }
  if (q.status) filter.status = q.status;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ reference: rx }, { 'contact.fullName': rx }, { 'contact.phone': rx }];
  }
  const [rows, total] = await Promise.all([
    Reservation.find(filter).sort({ status: 1, createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).populate(POP).lean<Populated[]>(),
    Reservation.countDocuments(filter),
  ]);
  return Page.of(rows.map((r) => dto(r, auth)), total, q.page, q.limit);
}

export async function listMyReservations(auth: AuthContext): Promise<ReservationDto[]> {
  const filter = { $or: [{ user: new Types.ObjectId(auth.userId) }, ...(auth.customerId ? [{ customer: new Types.ObjectId(auth.customerId) }] : [])] };
  const rows = await Reservation.find(filter).sort({ createdAt: -1 }).limit(50).populate(POP).lean<Populated[]>();
  return rows.map((r) => dto(r, auth));
}

export async function getReservation(auth: AuthContext, id: string): Promise<ReservationDto> {
  await findForAction(auth, id);
  return load(id, auth);
}

export async function trackReservation(reference: string, phone: string): Promise<ReservationTrackingDto> {
  const r = await Reservation.findOne({ reference, 'contact.phone': phone }).populate('branch', 'name phone whatsapp address city').lean<Populated>();
  if (!r) throw notFound('Reservation');
  return {
    reference: r.reference, status: r.status,
    branch: { name: r.branch.name, phone: r.branch.phone, whatsapp: r.branch.whatsapp, address: `${r.branch.address}, ${r.branch.city}` },
    itemCount: r.items.reduce((n, i) => n + i.quantity, 0), expiresAt: r.expiresAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
  };
}

// ------------------------------------------------------------------ background job

/** Releases stock held by reservations past their expiry. Returns how many expired. */
export async function expireReservations(now = new Date()): Promise<number> {
  const due = await Reservation.find({ status: { $in: OPEN }, expiresAt: { $lte: now } }).select('_id').limit(200).lean();
  let n = 0;
  for (const { _id } of due) {
    try {
      await withTransaction(async () => {
        const r = await Reservation.findOne({ _id, status: { $in: OPEN }, expiresAt: { $lte: now } });
        if (!r) return;
        await releaseHold(r, null, 'Reservation expired');
        pushStatus(r, 'expired', null, 'Hold period ended');
        await r.save();
        await tell(r, `Reservation ${r.reference} has expired`, 'The hold period ended and the items were released. You are welcome to reserve again.', 'expired');
        await audit({ action: 'reservation.expired', entity: { kind: 'Reservation', id: r._id, label: r.reference }, branch: r.branch });
      });
      n++;
    } catch {
      // Retried on the next run.
    }
  }
  return n;
}
