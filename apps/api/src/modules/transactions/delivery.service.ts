import { type DeliveryDto, type DeliveryStatus, PERMISSIONS, type listDeliveriesQuery } from '@mb/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import type { AuthContext } from '../../core/auth/AuthContext';
import { withTransaction } from '../../core/db/transaction';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors/AppError';
import { Page, skipFor } from '../../core/http/pagination';
import type { RequestMeta } from '../../core/http/route';
import { audit } from '../audit/audit.service';
import { Order } from '../commerce/commerce.models';
import { applyTransition, cancelOrderDoc, outstandingOf } from '../commerce/order-workflow';
import { User } from '../users/user.model';
import { Delivery, type IDelivery } from './transactions.models';

const P = PERMISSIONS;

/** Allowed delivery steps. "returned" brings the goods back and cancels the order (restocking it). */
const NEXT: Record<DeliveryStatus, DeliveryStatus[]> = {
  pending: ['assigned'],
  assigned: ['picked_up', 'failed'],
  picked_up: ['in_transit', 'delivered', 'failed'],
  in_transit: ['delivered', 'failed'],
  failed: ['assigned', 'returned'],
  delivered: [],
  returned: [],
};

type Populated = Omit<IDelivery, 'order' | 'branch'> & {
  _id: Types.ObjectId;
  order: { _id: Types.ObjectId; reference: string; status: string; total: number; amountPaid: number };
  branch: { _id: Types.ObjectId; name: string; code: string };
};

function dto(d: Populated): DeliveryDto {
  return {
    id: d._id.toString(),
    order: { id: d.order._id.toString(), reference: d.order.reference, status: d.order.status, total: d.order.total, outstanding: Math.max(0, d.order.total - d.order.amountPaid) },
    branch: { id: d.branch._id.toString(), name: d.branch.name, code: d.branch.code },
    customer: { fullName: d.contact.fullName, phone: d.contact.phone },
    address: { line1: d.address.line1, area: d.address.area ?? null, city: d.address.city, state: d.address.state, landmark: d.address.landmark ?? null },
    zone: d.zoneName ?? null,
    fee: d.fee,
    status: d.status,
    assignedTo: d.assignedTo?.name ? { userId: d.assignedTo.user?.toString() ?? null, name: d.assignedTo.name, phone: d.assignedTo.phone } : null,
    history: d.history.map((h) => ({ status: h.status, at: h.at.toISOString(), by: h.by ? h.by.toString() : null, note: h.note ?? null })),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

const POP = [
  { path: 'order', select: 'reference status total amountPaid' },
  { path: 'branch', select: 'name code' },
];

async function load(id: Types.ObjectId | string): Promise<DeliveryDto> {
  const d = await Delivery.findById(id).populate(POP).lean<Populated>();
  if (!d) throw notFound('Delivery');
  return dto(d);
}

export async function listDeliveries(auth: AuthContext, q: z.output<typeof listDeliveriesQuery>): Promise<Page<DeliveryDto>> {
  const filter: Record<string, unknown> = { ...auth.branchFilter(P.DELIVERY_READ) };
  if (q.branch) {
    if (!auth.canAccessBranch(P.DELIVERY_READ, q.branch)) return Page.of([], 0, q.page, q.limit);
    filter.branch = new Types.ObjectId(q.branch);
  }
  if (q.status) filter.status = q.status;
  const [rows, total] = await Promise.all([
    Delivery.find(filter).sort({ updatedAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).populate(POP).lean<Populated[]>(),
    Delivery.countDocuments(filter),
  ]);
  return Page.of(rows.map(dto), total, q.page, q.limit);
}

async function findManageable(auth: AuthContext, id: string) {
  const d = await Delivery.findById(id);
  if (!d || !auth.canAccessBranch(P.DELIVERY_READ, d.branch)) throw notFound('Delivery');
  if (!auth.canAccessBranch(P.DELIVERY_MANAGE, d.branch)) throw forbidden();
  return d;
}

export async function getDelivery(auth: AuthContext, id: string): Promise<DeliveryDto> {
  const d = await Delivery.findById(id).select('branch').lean();
  if (!d || !auth.canAccessBranch(P.DELIVERY_READ, d.branch)) throw notFound('Delivery');
  return load(id);
}

export async function assignDelivery(auth: AuthContext, id: string, input: { user?: string; name: string; phone: string }, meta: RequestMeta): Promise<DeliveryDto> {
  await withTransaction(async () => {
    const d = await findManageable(auth, id);
    if (!['pending', 'assigned', 'failed'].includes(d.status)) throw conflict('This delivery is already on its way.', undefined, 'INVALID_STATE');
    if (input.user && !(await User.exists({ _id: input.user, status: 'active', $or: [{ roleKey: 'SUPER_ADMIN' }, { branches: d.branch }] }))) {
      throw badRequest('Choose active staff of this branch, or enter an outside rider.');
    }
    d.assignedTo = { user: input.user ? new Types.ObjectId(input.user) : null, name: input.name, phone: input.phone };
    if (d.status !== 'assigned') d.history.push({ status: 'assigned', by: new Types.ObjectId(auth.userId), at: new Date(), note: `Rider: ${input.name}` });
    d.status = 'assigned';
    await d.save();
    await audit({ action: 'delivery.assigned', actor: auth, branch: d.branch, entity: { kind: 'Delivery', id: d._id }, meta: { rider: input.name } }, meta);
  });
  return load(id);
}

/**
 * Updates the delivery and keeps the order in step: once the rider leaves, the order is
 * "out for delivery" (the units are sold); on delivery a fully paid order completes;
 * returned goods cancel the order and go back on the shelf.
 */
export async function updateDeliveryStatus(auth: AuthContext, id: string, status: DeliveryStatus, note: string | undefined, meta: RequestMeta): Promise<{ delivery: DeliveryDto; message: string | null }> {
  let message: string | null = null;
  await withTransaction(async () => {
    const d = await findManageable(auth, id);
    if (!NEXT[d.status].includes(status)) throw conflict(`A delivery that is ${d.status.replace('_', ' ')} cannot become ${status.replace('_', ' ')}.`, { allowed: NEXT[d.status] }, 'INVALID_TRANSITION');
    const order = await Order.findById(d.order);
    if (!order) throw notFound('Order');

    if ((status === 'picked_up' || status === 'in_transit' || status === 'delivered') && order.status === 'processing') {
      await applyTransition(order, 'out_for_delivery', auth.userId, 'Rider left the branch');
    } else if ((status === 'picked_up' || status === 'in_transit') && order.status !== 'out_for_delivery') {
      throw conflict('Mark the order as being prepared before the rider leaves.', undefined, 'ORDER_NOT_READY');
    }
    // Re-read: the order transition updates the delivery record too.
    const fresh = (await Delivery.findById(d._id))!;
    fresh.status = status;
    fresh.history.push({ status, by: new Types.ObjectId(auth.userId), at: new Date(), note: note ?? null });
    await fresh.save();

    if (status === 'delivered') {
      if (outstandingOf(order) === 0) await applyTransition(order, 'completed', auth.userId, 'Delivered');
      else message = `Delivered. ₦${(outstandingOf(order) / 100).toLocaleString('en-NG')} is still to be paid: record the payment to complete the order.`;
    }
    if (status === 'returned') await cancelOrderDoc(order, auth.userId, `Delivery returned${note ? `: ${note}` : ''}`);
    await audit({ action: `delivery.${status}`, actor: auth, branch: d.branch, entity: { kind: 'Delivery', id: d._id }, meta: { order: order.reference, note } }, meta);
  });
  return { delivery: await load(id), message };
}
