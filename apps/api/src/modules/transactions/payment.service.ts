import {
  PERMISSIONS,
  type PaymentConfigDto,
  type PaymentDto,
  type ReceiptDto,
  type listPaymentsQuery,
  type recordPaymentSchema,
  type refundSchema,
  toWhatsAppNumber,
} from '@mb/shared';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import type { AuthContext } from '../../core/auth/AuthContext';
import { nextReference } from '../../core/db/counter';
import { withTransaction } from '../../core/db/transaction';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../core/errors/AppError';
import { Page, escapeRegex, skipFor } from '../../core/http/pagination';
import type { RequestMeta } from '../../core/http/route';
import { createRefund, initializeTransaction, verifyTransaction, verifyWebhookSignature } from '../../core/payments/paystack';
import { audit } from '../audit/audit.service';
import { Branch } from '../branches/branch.model';
import { Order, type OrderDoc } from '../commerce/commerce.models';
import { isMine, staffFilter } from '../commerce/order.service';
import { applyTransition, outstandingOf, recomputePayments } from '../commerce/order-workflow';
import { Customer } from '../customers/customer.model';
import { applyReturn } from '../inventory/inventory.service';
import { notifyBranchTeam, notifyCustomer } from '../notifications/notification.service';
import { getSettingsDoc } from '../settings/settings.service';
import { type IPayment, Payment, type PaymentDoc, WebhookEvent } from './transactions.models';

const P = PERMISSIONS;
const naira = (k: number) => `₦${(k / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

type Populated = Omit<IPayment, 'order' | 'branch' | 'customer' | 'recordedBy'> & {
  _id: Types.ObjectId;
  order: { _id: Types.ObjectId; reference: string };
  branch: { _id: Types.ObjectId; name: string; code: string };
  customer: { _id: Types.ObjectId; fullName: string };
  recordedBy: { _id: Types.ObjectId; fullName: string } | null;
};

function dto(p: Populated): PaymentDto {
  return {
    id: p._id.toString(),
    reference: p.reference,
    order: { id: p.order._id.toString(), reference: p.order.reference },
    branch: { id: p.branch._id.toString(), name: p.branch.name, code: p.branch.code },
    customer: { id: p.customer._id.toString(), fullName: p.customer.fullName },
    method: p.method,
    amount: p.amount,
    status: p.status,
    providerReference: p.providerReference ?? null,
    receiptNumber: p.receiptNumber ?? null,
    refunds: p.refunds.map((r) => ({ amount: r.amount, reason: r.reason, status: r.status, at: r.at.toISOString(), by: r.by ? r.by.toString() : null })),
    refundedAmount: p.refunds.filter((r) => r.status !== 'failed').reduce((n, r) => n + r.amount, 0),
    recordedBy: p.recordedBy ? { id: p.recordedBy._id.toString(), fullName: p.recordedBy.fullName } : null,
    verifiedBy: p.verifiedBy ?? null,
    verifiedAt: p.verifiedAt?.toISOString() ?? null,
    note: p.note ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

const POP = [
  { path: 'order', select: 'reference' },
  { path: 'branch', select: 'name code' },
  { path: 'customer', select: 'fullName' },
  { path: 'recordedBy', select: 'fullName' },
];

async function load(id: Types.ObjectId | string): Promise<PaymentDto> {
  const p = await Payment.findById(id).populate(POP).lean<Populated>();
  if (!p) throw notFound('Payment');
  return dto(p);
}

async function branchCode(id: Types.ObjectId) {
  return (await Branch.findById(id).select('code').lean())!.code;
}

/**
 * Marks a pending payment successful exactly once (conditional update), issues a receipt
 * number, updates the order balance, and confirms a pending online order once it is fully paid.
 */
async function settle(paymentId: Types.ObjectId, via: { verifiedBy: 'webhook' | 'verify_api' | 'staff'; user?: string | null; provider?: Partial<NonNullable<IPayment['provider']>> }) {
  const payment = await Payment.findById(paymentId);
  if (!payment || payment.status !== 'pending') return false;
  const order = await Order.findById(payment.order);
  if (!order) return false;
  const receiptNumber = await nextReference('RCP', await branchCode(payment.branch));
  const done = await Payment.findOneAndUpdate(
    { _id: payment._id, status: 'pending' },
    {
      $set: {
        status: 'success', receiptNumber, verifiedBy: via.verifiedBy, verifiedByUser: via.user ?? null, verifiedAt: new Date(),
        ...(via.provider ? { provider: { ...(payment.provider ?? {}), ...via.provider, name: 'paystack' } } : {}),
      },
    },
    { returnDocument: 'after' },
  );
  if (!done) return false;
  await recomputePayments(order);
  if (order.status === 'pending' && order.channel === 'online' && outstandingOf(order) === 0) {
    await applyTransition(order, 'confirmed', via.user ?? null, 'Paid in full');
  } else {
    await order.save();
  }
  await notifyCustomer(order.customer, {
    type: 'payment.received', title: `Payment received for ${order.reference}`,
    body: `We received ${naira(done.amount)} for order ${order.reference} (receipt ${receiptNumber}).${outstandingOf(order) > 0 ? ` ${naira(outstandingOf(order))} is still to be paid.` : ''}`,
    link: `/account/orders/${order.reference}`, branch: order.branch, contactEmail: order.contact.email,
  });
  await notifyBranchTeam(order.branch, P.PAYMENTS_CONFIRM, { type: 'payment.received', title: `Payment received: ${order.reference}`, body: `${naira(done.amount)} by ${done.method.replace('_', ' ')}.`, link: `/admin/orders/${order._id}` });
  return true;
}

function assertOrderPayable(order: OrderDoc) {
  if (['cancelled', 'refunded'].includes(order.status)) throw conflict(`This order is ${order.status}.`, undefined, 'INVALID_STATE');
}

// ------------------------------------------------------------------ staff: cash, POS and bank transfer

export async function recordPayment(auth: AuthContext, input: z.output<typeof recordPaymentSchema>, meta: RequestMeta): Promise<PaymentDto> {
  const id = await withTransaction(async () => {
    const order = await Order.findOne({ _id: input.order, ...staffFilter(auth) });
    if (!order) throw notFound('Order');
    if (!auth.canAccessBranch(P.PAYMENTS_RECORD, order.branch)) throw forbidden();
    assertOrderPayable(order);
    const pending = await Payment.find({ order: order._id, status: 'pending' }).select('amount').lean();
    const room = outstandingOf(order) - pending.reduce((n, p) => n + p.amount, 0);
    if (input.amount > room) {
      throw badRequest(room <= 0 ? 'Nothing is left to pay on this order.' : `Only ${naira(room)} is left to pay.`, { amount: [`At most ${naira(Math.max(0, room))}`] }, 'OVERPAYMENT');
    }
    if (input.method === 'bank_transfer' && !input.providerReference) throw badRequest('Enter the transfer reference from the bank alert.', { providerReference: ['Required for bank transfers'] });
    const [payment] = await Payment.create([
      {
        reference: await nextReference('PAY', await branchCode(order.branch)),
        order: order._id, branch: order.branch, customer: order.customer, method: input.method, amount: input.amount,
        providerReference: input.providerReference ?? null, note: input.note ?? null, recordedBy: auth.userId, status: 'pending',
      },
    ]);
    // Cash and POS are seen by the person recording them. A bank transfer must be checked against
    // the bank account by someone allowed to confirm payments.
    const immediate = input.method !== 'bank_transfer' || auth.canAccessBranch(P.PAYMENTS_CONFIRM, order.branch);
    if (immediate) await settle(payment!._id, { verifiedBy: 'staff', user: auth.userId });
    else await notifyBranchTeam(order.branch, P.PAYMENTS_CONFIRM, { type: 'payment.to_confirm', title: `Confirm bank transfer for ${order.reference}`, body: `${naira(input.amount)}, reference ${input.providerReference}. Check the account before confirming.`, link: `/admin/payments` });
    await audit({ action: 'payment.recorded', actor: auth, branch: order.branch, entity: { kind: 'Payment', id: payment!._id, label: payment!.reference }, meta: { order: order.reference, method: input.method, amount: input.amount } }, meta);
    return payment!._id;
  });
  return load(id);
}

export async function reviewPayment(auth: AuthContext, id: string, decision: 'confirm' | 'reject', note: string | undefined, meta: RequestMeta): Promise<PaymentDto> {
  await withTransaction(async () => {
    const p = await Payment.findById(id);
    if (!p || !auth.canAccessBranch(P.PAYMENTS_READ, p.branch)) throw notFound('Payment');
    if (!auth.canAccessBranch(P.PAYMENTS_CONFIRM, p.branch)) throw forbidden();
    if (p.status !== 'pending' || p.method === 'paystack') throw conflict('Only pending manual payments can be confirmed or rejected.', undefined, 'INVALID_STATE');
    if (decision === 'confirm') await settle(p._id, { verifiedBy: 'staff', user: auth.userId });
    else await Payment.updateOne({ _id: p._id, status: 'pending' }, { $set: { status: 'failed', note: note ?? p.note } });
    await audit({ action: `payment.${decision === 'confirm' ? 'confirmed' : 'rejected'}`, actor: auth, branch: p.branch, entity: { kind: 'Payment', id: p._id, label: p.reference }, meta: { note } }, meta);
  });
  return load(id);
}

// ------------------------------------------------------------------ refunds

export async function refundPayment(auth: AuthContext, id: string, input: z.output<typeof refundSchema>, meta: RequestMeta): Promise<PaymentDto> {
  const p0 = await Payment.findById(id).select('branch method status amount refunds reference').lean();
  if (!p0 || !auth.canAccessBranch(P.PAYMENTS_READ, p0.branch)) throw notFound('Payment');
  if (!auth.canAccessBranch(P.PAYMENTS_REFUND, p0.branch)) throw forbidden();
  if (p0.status !== 'success') throw conflict('Only successful payments can be refunded.', undefined, 'INVALID_STATE');
  const already = p0.refunds.filter((r) => r.status !== 'failed').reduce((n, r) => n + r.amount, 0);
  if (input.amount > p0.amount - already) throw badRequest(`At most ${naira(p0.amount - already)} can still be refunded on this payment.`, { amount: ['Too much'] });

  // Card refunds go through Paystack first; the result is confirmed later by its webhook.
  let providerRefundId: string | null = null;
  if (p0.method === 'paystack') {
    const r = await createRefund({ transaction: p0.reference, amount: input.amount, reason: input.reason });
    providerRefundId = String(r.id);
  }

  await withTransaction(async () => {
    const p = await Payment.findById(id);
    const order = await Order.findById(p!.order);
    if (!p || !order) throw notFound('Payment');
    const restock = input.restock && order.status === 'completed';
    if (input.restock && !restock) throw badRequest('Items can only be put back into stock for completed orders. Cancel open orders instead.');
    p.refunds.push({ amount: input.amount, reason: input.reason, status: p.method === 'paystack' ? 'pending' : 'processed', providerRefundId, restock, by: new Types.ObjectId(auth.userId), at: new Date() });
    await p.save();
    if (restock) {
      for (const i of order.items) {
        await applyReturn({ branch: order.branch, product: i.product, variantId: i.variantId, sku: i.sku, quantity: i.quantity, reference: { kind: 'Order', id: order._id, label: order.reference }, reason: `Returned: ${input.reason}`, performedBy: auth.userId });
      }
    }
    await recomputePayments(order);
    if (order.status === 'completed') {
      await Customer.updateOne({ _id: order.customer }, { $inc: { 'stats.totalSpent': -input.amount } });
      if (restock || order.amountPaid <= 0) {
        order.statusHistory.push({ from: 'completed', to: 'refunded', by: new Types.ObjectId(auth.userId), at: new Date(), note: input.reason });
        order.status = 'refunded';
      }
    }
    await order.save();
    await notifyCustomer(order.customer, { type: 'payment.refund', title: `Refund for ${order.reference}`, body: `A refund of ${naira(input.amount)} for order ${order.reference} has been ${p.method === 'paystack' ? 'started. It usually reaches your card within a few working days' : 'made'}.`, link: `/account/orders/${order.reference}`, contactEmail: order.contact.email, branch: order.branch });
    await audit({ action: 'payment.refunded', actor: auth, branch: p.branch, entity: { kind: 'Payment', id: p._id, label: p.reference }, meta: { amount: input.amount, reason: input.reason, restock } }, meta);
  });
  return load(id);
}

// ------------------------------------------------------------------ Paystack

export async function paymentConfig(): Promise<PaymentConfigDto> {
  const s = await getSettingsDoc();
  return { paystackEnabled: env.paystackEnabled, bankTransfer: s.bankTransfer?.accountNumber ? { bankName: s.bankTransfer.bankName, accountName: s.bankTransfer.accountName, accountNumber: s.bankTransfer.accountNumber } : null };
}

/** Starts a card payment for the outstanding balance and returns Paystack's checkout page. */
export async function initializePaystack(auth: AuthContext | null, reference: string, phone: string | undefined, meta: RequestMeta): Promise<{ authorizationUrl: string; reference: string }> {
  if (!env.paystackEnabled) throw new AppError(503, 'PAYMENTS_UNAVAILABLE', 'Card payments are not available right now.');
  const order = await Order.findOne({ reference });
  const allowed = order && (auth ? isMine(auth, order) || Boolean(phone && order.contact.phone === phone) : Boolean(phone && order.contact.phone === phone));
  if (!order || !allowed) throw notFound('Order');
  assertOrderPayable(order);
  const amount = outstandingOf(order);
  if (amount <= 0) throw conflict('This order is already paid.', undefined, 'ALREADY_PAID');

  // Reuse a recent unfinished attempt for the same amount instead of creating duplicates.
  const recent = await Payment.findOne({ order: order._id, method: 'paystack', status: 'pending', amount, createdAt: { $gt: new Date(Date.now() - 30 * 60_000) } }).lean();
  if (recent?.provider?.authorizationUrl) return { authorizationUrl: recent.provider.authorizationUrl, reference: recent.reference };

  const ref = await nextReference('PAY', await branchCode(order.branch));
  // Paystack requires an email; customers without one get a stable placeholder tied to their phone.
  const email = order.contact.email ?? `${toWhatsAppNumber(order.contact.phone)}@customers.mudassirbrothers.com`;
  const init = await initializeTransaction({ email, amount, reference: ref, callbackUrl: `${env.WEB_URL}/payment/callback`, metadata: { orderId: order._id.toString(), orderReference: order.reference } });
  await Payment.create({
    reference: ref, order: order._id, branch: order.branch, customer: order.customer, method: 'paystack', amount, status: 'pending',
    provider: { name: 'paystack', authorizationUrl: init.authorization_url },
  });
  await audit({ action: 'payment.paystack_started', actor: auth, branch: order.branch, entity: { kind: 'Order', id: order._id, label: order.reference }, meta: { amount, reference: ref } }, meta);
  return { authorizationUrl: init.authorization_url, reference: ref };
}

/** Applies Paystack's verdict on a transaction. Amount and currency must match what we asked for. */
async function applyPaystackResult(payment: PaymentDoc, tx: { status: string; amount: number; currency: string; id?: number; channel?: string; paid_at?: string | null }, via: 'webhook' | 'verify_api') {
  if (payment.status !== 'pending') return;
  if (tx.status === 'success') {
    if (tx.amount !== payment.amount || tx.currency !== 'NGN') {
      logger.error({ reference: payment.reference, expected: payment.amount, got: tx.amount, currency: tx.currency }, 'Paystack amount mismatch');
      await Payment.updateOne({ _id: payment._id, status: 'pending' }, { $set: { status: 'failed', note: `Amount mismatch: expected ${payment.amount}, got ${tx.amount} ${tx.currency}` } });
      return;
    }
    await withTransaction(() =>
      settle(payment._id, { verifiedBy: via, provider: { transactionId: tx.id ? String(tx.id) : null, channel: tx.channel ?? null, paidAt: tx.paid_at ? new Date(tx.paid_at) : new Date(), raw: tx } }),
    );
  } else if (['failed', 'abandoned', 'reversed'].includes(tx.status)) {
    await Payment.updateOne({ _id: payment._id, status: 'pending' }, { $set: { status: tx.status } });
  }
}

/** Called when the customer returns from Paystack. The browser's word is never trusted: we ask Paystack. */
export async function verifyPaystack(reference: string): Promise<{ status: string; orderReference: string; amount: number; outstanding: number }> {
  const payment = await Payment.findOne({ reference, method: 'paystack' });
  if (!payment) throw notFound('Payment');
  if (payment.status === 'pending') await applyPaystackResult(payment, await verifyTransaction(reference), 'verify_api');
  const [fresh, order] = await Promise.all([Payment.findById(payment._id).lean(), Order.findById(payment.order).lean()]);
  return { status: fresh!.status, orderReference: order!.reference, amount: fresh!.amount, outstanding: outstandingOf(order!) };
}

/** Signed Paystack events. Each event is processed once, however often Paystack retries it. */
export async function handlePaystackWebhook(raw: Buffer | undefined, signature: string | undefined, body: unknown): Promise<{ ok: true }> {
  if (!verifyWebhookSignature(raw, signature)) throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid signature');
  const evt = body as { event?: string; data?: { id?: number; reference?: string; status?: string; amount?: number; currency?: string; channel?: string; paid_at?: string; transaction_reference?: string; transaction?: { reference?: string } } };
  const event = evt.event ?? 'unknown';
  const key = `${event}:${evt.data?.id ?? evt.data?.reference ?? ''}`;
  try {
    await WebhookEvent.create({ provider: 'paystack', eventKey: key, event, payload: body });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return { ok: true }; // already processed
    throw err;
  }

  if (event === 'charge.success' && evt.data?.reference) {
    const payment = await Payment.findOne({ reference: evt.data.reference, method: 'paystack' });
    if (payment) {
      // Re-check with the API rather than trusting the payload alone.
      const tx = await verifyTransaction(evt.data.reference).catch(() => null);
      await applyPaystackResult(payment, tx ?? { status: 'pending', amount: 0, currency: 'NGN' }, 'webhook');
    }
  } else if ((event === 'refund.processed' || event === 'refund.failed') && evt.data) {
    const txRef = evt.data.transaction_reference ?? evt.data.transaction?.reference;
    const payment = txRef ? await Payment.findOne({ reference: txRef }) : null;
    const refund = payment?.refunds.find((r) => r.providerRefundId === String(evt.data!.id)) ?? payment?.refunds.find((r) => r.status === 'pending');
    if (payment && refund && refund.status === 'pending') {
      refund.status = event === 'refund.processed' ? 'processed' : 'failed';
      await payment.save();
      const order = await Order.findById(payment.order);
      if (order) {
        await recomputePayments(order);
        await order.save();
      }
    }
  }
  await WebhookEvent.updateOne({ provider: 'paystack', eventKey: key }, { $set: { processedAt: new Date() } });
  return { ok: true };
}

// ------------------------------------------------------------------ reading

export async function listPayments(auth: AuthContext, q: z.output<typeof listPaymentsQuery>): Promise<Page<PaymentDto>> {
  const filter: Record<string, unknown> = { ...auth.branchFilter(P.PAYMENTS_READ) };
  if (q.branch) {
    if (!auth.canAccessBranch(P.PAYMENTS_READ, q.branch)) return Page.of([], 0, q.page, q.limit);
    filter.branch = new Types.ObjectId(q.branch);
  }
  if (q.status) filter.status = q.status;
  if (q.method) filter.method = q.method;
  if (q.q) filter.$or = [{ reference: new RegExp(escapeRegex(q.q), 'i') }, { receiptNumber: new RegExp(escapeRegex(q.q), 'i') }, { providerReference: new RegExp(escapeRegex(q.q), 'i') }];
  const [rows, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip(skipFor(q.page, q.limit)).limit(q.limit).populate(POP).lean<Populated[]>(),
    Payment.countDocuments(filter),
  ]);
  return Page.of(rows.map(dto), total, q.page, q.limit);
}

export async function getPayment(auth: AuthContext, id: string): Promise<PaymentDto> {
  const p = await Payment.findById(id).select('branch').lean();
  if (!p || !auth.canAccessBranch(P.PAYMENTS_READ, p.branch)) throw notFound('Payment');
  return load(id);
}

/** Receipt for an order (customer: their own; staff: within their scope). */
export async function orderReceipt(auth: AuthContext, ref: { reference?: string; id?: string }, asStaff: boolean): Promise<ReceiptDto> {
  const order = ref.id ? await Order.findOne({ _id: ref.id, ...(asStaff ? staffFilter(auth) : {}) }) : await Order.findOne({ reference: ref.reference });
  if (!order || (!asStaff && !isMine(auth, order))) throw notFound('Order');
  const [branch, settings, payments] = await Promise.all([
    Branch.findById(order.branch).select('name address city phone code').lean(),
    getSettingsDoc(),
    Payment.find({ order: order._id, status: 'success' }).sort({ verifiedAt: 1 }).lean(),
  ]);
  const vatAmount = settings.showVatOnReceipts && settings.pricesIncludeVat ? Math.round((order.total * settings.vatRatePercent) / (100 + settings.vatRatePercent)) : null;
  return {
    receiptNumber: payments.at(-1)?.receiptNumber ?? `${order.reference}-PROFORMA`,
    issuedAt: new Date().toISOString(),
    company: { name: settings.companyName, address: settings.address ?? null, phone: settings.supportPhone, email: settings.supportEmail, footer: settings.receiptFooter ?? null, vat: { show: settings.showVatOnReceipts, ratePercent: settings.vatRatePercent, included: settings.pricesIncludeVat } },
    branch: { name: branch!.name, address: `${branch!.address}, ${branch!.city}`, phone: branch!.phone },
    order: { reference: order.reference, createdAt: order.createdAt.toISOString(), fulfilment: order.fulfilment.method },
    customer: { fullName: order.contact.fullName, phone: order.contact.phone },
    items: order.items.map((i) => ({ name: i.variantLabel ? `${i.name} (${i.variantLabel})` : i.name, sku: i.sku, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal })),
    subtotal: order.subtotal,
    discount: order.discountTotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    vatAmount,
    payments: payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.receiptNumber ?? p.reference, at: (p.verifiedAt ?? p.createdAt).toISOString() })),
    amountPaid: order.amountPaid,
    outstanding: outstandingOf(order),
  };
}

