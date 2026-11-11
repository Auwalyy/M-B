import { ORDER_CANCELLABLE, ORDER_TRANSITIONS, type OrderStatus } from '@mb/shared';
import { Types } from 'mongoose';
import { AppError, conflict } from '../../core/errors/AppError';
import { Customer } from '../customers/customer.model';
import { applyReservation, applyReturn, applySale } from '../inventory/inventory.service';
import { notifyCustomer } from '../notifications/notification.service';
import { getSettingsDoc } from '../settings/settings.service';
import { Delivery, Payment } from '../transactions/transactions.models';
import { type OrderDoc, Promotion } from './commerce.models';

export const STATUS_TEXT: Record<OrderStatus, string> = {
  pending: 'received',
  confirmed: 'confirmed',
  processing: 'being prepared',
  ready_for_pickup: 'ready for pickup',
  out_for_delivery: 'out for delivery',
  completed: 'completed',
  cancelled: 'cancelled',
  refunded: 'refunded',
};

export const outstandingOf = (o: Pick<OrderDoc, 'total' | 'amountPaid'>) => Math.max(0, o.total - o.amountPaid);

/** Units have left the shelf once a delivery is dispatched or a pickup is completed. */
export const stockHasLeft = (o: Pick<OrderDoc, 'status'>) => o.status === 'out_for_delivery' || o.status === 'completed';

/** Recomputes amount paid (successful payments minus processed refunds) and the payment status. */
export async function recomputePayments(order: OrderDoc): Promise<void> {
  const payments = await Payment.find({ order: order._id, status: 'success' }).select('amount refunds').lean();
  const received = payments.reduce((n, p) => n + p.amount, 0);
  const refunded = payments.reduce((n, p) => n + p.refunds.filter((r) => r.status === 'processed').reduce((m, r) => m + r.amount, 0), 0);
  order.amountPaid = received - refunded;
  order.paymentStatus =
    refunded > 0 && order.amountPaid <= 0 ? 'refunded' : refunded > 0 ? 'partially_refunded' : order.amountPaid >= order.total ? 'paid' : order.amountPaid > 0 ? 'partially_paid' : 'unpaid';
}

function notifyStatus(order: OrderDoc, to: OrderStatus) {
  const link = `/account/orders/${order.reference}`;
  const extra =
    to === 'ready_for_pickup' ? ' Bring your order number when you come.' : to === 'out_for_delivery' ? ' Please keep your phone close so the rider can reach you.' : '';
  return notifyCustomer(order.customer, {
    type: `order.${to}`,
    title: `Order ${order.reference} is ${STATUS_TEXT[to]}`,
    body: `Your order ${order.reference} is ${STATUS_TEXT[to]}.${extra}`,
    link,
    branch: order.branch,
    contactEmail: order.contact.email,
    whatsapp: { template: 'order', params: [order.contact.fullName.split(' ')[0] ?? order.contact.fullName, order.reference, STATUS_TEXT[to]], related: { kind: 'Order', id: order._id } },
  });
}

/**
 * Moves an order one step along the workflow and applies the stock effects:
 * dispatching a delivery or completing a pickup turns held units into a sale.
 * Completing requires the order to be fully paid.
 */
export async function applyTransition(order: OrderDoc, to: OrderStatus, by: string | null, note?: string | null): Promise<void> {
  if (!ORDER_TRANSITIONS[order.status].includes(to)) {
    throw conflict(`A ${order.status.replace(/_/g, ' ')} order cannot become ${to.replace(/_/g, ' ')}.`, { allowed: ORDER_TRANSITIONS[order.status] }, 'INVALID_TRANSITION');
  }
  if (to === 'ready_for_pickup' && order.fulfilment.method !== 'pickup') throw conflict('This is a delivery order. Dispatch it instead.', undefined, 'INVALID_TRANSITION');
  if (to === 'out_for_delivery' && order.fulfilment.method !== 'delivery') throw conflict('This is a pickup order. Mark it ready for pickup instead.', undefined, 'INVALID_TRANSITION');
  if (to === 'completed' && outstandingOf(order) > 0) {
    throw new AppError(409, 'OUTSTANDING_BALANCE', `₦${(outstandingOf(order) / 100).toLocaleString('en-NG')} is still to be paid. Record the payment first.`, { outstanding: outstandingOf(order) });
  }

  const settings = await getSettingsDoc();
  const sellNow = to === 'out_for_delivery' || (to === 'completed' && order.fulfilment.method === 'pickup');
  if (sellNow) {
    for (const i of order.items) {
      await applySale({
        branch: order.branch, product: i.product, variantId: i.variantId, sku: i.sku, quantity: i.quantity,
        reference: { kind: 'Order', id: order._id, label: order.reference }, reason: to === 'completed' ? 'Collected by customer' : 'Dispatched for delivery',
        performedBy: by, lowStockDefault: settings.lowStockDefault,
      });
    }
  }
  const now = new Date();
  order.statusHistory.push({ from: order.status, to, by: by ? new Types.ObjectId(by) : null, at: now, note: note ?? null });
  order.status = to;
  if (to === 'confirmed') order.confirmedAt = now;
  if (to === 'completed') {
    order.completedAt = now;
    await Customer.updateOne({ _id: order.customer }, { $inc: { 'stats.orderCount': 1, 'stats.totalSpent': order.total }, $set: { 'stats.lastOrderAt': now } });
  }
  await order.save(); // optimistic concurrency: a parallel change fails with 409
  if (to === 'out_for_delivery') await Delivery.updateOne({ order: order._id, status: { $in: ['pending', 'assigned', 'picked_up'] } }, { $set: { status: 'in_transit' }, $push: { history: { status: 'in_transit', by, at: now, note: 'Order dispatched' } } });
  if (to === 'completed') await Delivery.updateOne({ order: order._id, status: { $ne: 'delivered' } }, { $set: { status: 'delivered' }, $push: { history: { status: 'delivered', by, at: now, note: 'Order completed' } } });
  await notifyStatus(order, to);
}

/**
 * Cancels an open order. Held units are released; units already sold (dispatched) are put back
 * on the shelf. Money received is not refunded automatically: the response tells staff to refund.
 */
export async function cancelOrderDoc(order: OrderDoc, by: string | null, note: string): Promise<void> {
  if (!ORDER_CANCELLABLE.includes(order.status)) throw conflict(`A ${order.status.replace(/_/g, ' ')} order cannot be cancelled.`, undefined, 'INVALID_STATE');
  const settings = await getSettingsDoc();
  const ref = { kind: 'Order', id: order._id, label: order.reference };
  for (const i of order.items) {
    if (stockHasLeft(order)) {
      await applyReturn({ branch: order.branch, product: i.product, variantId: i.variantId, sku: i.sku, quantity: i.quantity, reference: ref, reason: 'Order cancelled after dispatch', performedBy: by });
    } else {
      await applyReservation({ branch: order.branch, product: i.product, variantId: i.variantId, sku: i.sku, delta: -i.quantity, reference: ref, reason: 'Order cancelled', performedBy: by, lowStockDefault: settings.lowStockDefault });
    }
  }
  if (order.promotion?.id) await Promotion.updateOne({ _id: order.promotion.id, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
  const now = new Date();
  order.statusHistory.push({ from: order.status, to: 'cancelled', by: by ? new Types.ObjectId(by) : null, at: now, note });
  order.status = 'cancelled';
  order.cancelledAt = now;
  await order.save();
  await Delivery.updateOne({ order: order._id, status: { $nin: ['delivered', 'returned'] } }, { $set: { status: 'failed' }, $push: { history: { status: 'failed', by, at: now, note: 'Order cancelled' } } });
  await notifyCustomer(order.customer, {
    type: 'order.cancelled',
    title: `Order ${order.reference} was cancelled`,
    body: order.amountPaid > 0 ? `Your order ${order.reference} was cancelled. The branch will refund what you paid.` : `Your order ${order.reference} was cancelled.`,
    link: `/account/orders/${order.reference}`,
    branch: order.branch,
    contactEmail: order.contact.email,
    whatsapp: { template: 'order', params: [order.contact.fullName.split(' ')[0] ?? '', order.reference, 'cancelled'], related: { kind: 'Order', id: order._id } },
  });
}
