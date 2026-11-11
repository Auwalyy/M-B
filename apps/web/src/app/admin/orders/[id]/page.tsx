'use client';

import { type DeliveryDto, type OrderDto, type OrderStatus, PERMISSIONS, formatNaira, formatPhone, toWhatsAppNumber } from '@mb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bike, CreditCard, MessageCircle, Phone, Printer, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { NairaInput, Thumb } from '@/components/admin/commerce';
import { ORDER_STATUS, OrderStatusBadge } from '@/components/store/order-status';
import { Button, ButtonLink, buttonClasses } from '@/components/ui/button';
import { Alert, Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader, Skeleton } from '@/components/ui/display';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, nairaInputValue, parseNaira } from '@/lib/utils';

const PAY: Record<string, string> = { pay_on_pickup: 'Pay at branch', pay_on_delivery: 'Pay on delivery', bank_transfer: 'Bank transfer', paystack: 'Card (online)', cash: 'Cash', pos: 'Card (POS)' };
const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  confirmed: 'Confirm order',
  processing: 'Start preparing',
  ready_for_pickup: 'Ready for pickup',
  out_for_delivery: 'Dispatch for delivery',
  completed: 'Complete order',
};
const DELIVERY_NEXT: Record<string, string[]> = { pending: [], assigned: ['picked_up', 'failed'], picked_up: ['in_transit', 'delivered', 'failed'], in_transit: ['delivered', 'failed'], failed: ['returned'], delivered: [], returned: [] };
const DELIVERY_LABEL: Record<string, string> = { pending: 'Waiting for a rider', assigned: 'Rider assigned', picked_up: 'Picked up', in_transit: 'On the way', delivered: 'Delivered', failed: 'Delivery failed', returned: 'Returned to branch' };

function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) toast.success(done);
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

function PaymentsCard({ o, reload }: { o: OrderDto; reload: () => void }) {
  const { user } = useAuth();
  const can = (p: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => Boolean(user?.permissions.includes(p));
  const { busy, run } = useAction();
  const [recording, setRecording] = useState(false);
  const [method, setMethod] = useState<'cash' | 'pos' | 'bank_transfer'>('cash');
  const [amount, setAmount] = useState(nairaInputValue(o.outstanding));
  const [ref, setRef] = useState('');
  const [refundFor, setRefundFor] = useState<OrderDto['payments'][number] | null>(null);
  const [refund, setRefund] = useState({ amount: '', reason: '', restock: false });
  const open = !['cancelled', 'refunded'].includes(o.status);

  return (
    <Card>
      <CardHeader
        title="Payments"
        description={o.outstanding > 0 ? <span className="font-semibold text-danger-700">{formatNaira(o.outstanding)} still to pay</span> : 'Paid in full'}
        actions={open && o.outstanding > 0 && can(PERMISSIONS.PAYMENTS_RECORD) && <Button size="sm" onClick={() => { setAmount(nairaInputValue(o.outstanding)); setRecording(true); }}><CreditCard className="h-4 w-4" /> Record payment</Button>}
      />
      <CardBody className="p-0">
        {o.payments.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">No payments yet. Customer chose: {PAY[o.paymentMethod]}.</p>
        ) : (
          <ul className="divide-y divide-line">
            {o.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{formatNaira(p.amount)} · {PAY[p.method]}</p>
                  <p className="text-xs text-ink-muted">{p.receiptNumber ?? p.reference}{p.verifiedAt ? ` · ${formatDateTime(p.verifiedAt)}` : ''}{p.refundedAmount ? ` · ${formatNaira(p.refundedAmount)} refunded` : ''}</p>
                </div>
                {p.status === 'pending' ? <Badge tone="warning">Awaiting confirmation</Badge> : <Badge tone="success">Received</Badge>}
                {p.status === 'pending' && p.method === 'bank_transfer' && can(PERMISSIONS.PAYMENTS_CONFIRM) && (
                  <>
                    <Button size="sm" loading={busy === `c${p.id}`} onClick={() => run(`c${p.id}`, () => api.post(`/payments/${p.id}/confirm`, {}), 'Transfer confirmed').then(reload)}>Confirm</Button>
                    <Button size="sm" variant="ghost" loading={busy === `r${p.id}`} onClick={() => run(`r${p.id}`, () => api.post(`/payments/${p.id}/reject`, { note: 'Not received' }), 'Marked as not received').then(reload)}>Not received</Button>
                  </>
                )}
                {p.status === 'success' && p.refundedAmount < p.amount && can(PERMISSIONS.PAYMENTS_REFUND) && (
                  <Button size="sm" variant="ghost" onClick={() => { setRefund({ amount: nairaInputValue(p.amount - p.refundedAmount), reason: '', restock: false }); setRefundFor(p); }}><Undo2 className="h-4 w-4" /> Refund</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <Dialog open={recording} onOpenChange={setRecording} title="Record a payment" description={`Balance: ${formatNaira(o.outstanding)}`} size="sm"
        footer={<><Button variant="secondary" onClick={() => setRecording(false)}>Cancel</Button><Button loading={busy === 'pay'} onClick={async () => {
          const kobo = parseNaira(amount);
          if (!kobo || Number.isNaN(kobo)) return;
          if (await run('pay', () => api.post('/payments', { order: o.id, method, amount: kobo, providerReference: ref || undefined }), method === 'bank_transfer' && !user?.permissions.includes(PERMISSIONS.PAYMENTS_CONFIRM) ? 'Recorded. A branch admin will confirm the transfer.' : 'Payment recorded')) { setRecording(false); setRef(''); reload(); }
        }}>Record</Button></>}>
        <div className="space-y-4">
          <Field label="Method">{(p) => <Select {...p} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}><option value="cash">Cash</option><option value="pos">Card (POS)</option><option value="bank_transfer">Bank transfer</option></Select>}</Field>
          <Field label="Amount received" required>{(p) => <NairaInput {...p} value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          {method !== 'cash' && <Field label={method === 'bank_transfer' ? 'Transfer reference (from the bank alert)' : 'POS slip number'} required={method === 'bank_transfer'}>{(p) => <Input {...p} value={ref} onChange={(e) => setRef(e.target.value)} />}</Field>}
        </div>
      </Dialog>

      <Dialog open={Boolean(refundFor)} onOpenChange={(v) => !v && setRefundFor(null)} title="Refund" description={refundFor ? `Up to ${formatNaira(refundFor.amount - refundFor.refundedAmount)}${refundFor.method === 'paystack' ? '. Card refunds go back to the customer’s card through Paystack.' : '. Give the money back to the customer before confirming.'}` : ''} size="sm"
        footer={<><Button variant="secondary" onClick={() => setRefundFor(null)}>Cancel</Button><Button variant="danger" loading={busy === 'refund'} onClick={async () => {
          const kobo = parseNaira(refund.amount);
          if (!kobo || Number.isNaN(kobo) || !refundFor) return;
          if (await run('refund', () => api.post(`/payments/${refundFor.id}/refunds`, { amount: kobo, reason: refund.reason, restock: refund.restock }), 'Refund recorded')) { setRefundFor(null); reload(); }
        }}>Refund</Button></>}>
        <div className="space-y-4">
          <Field label="Amount" required>{(p) => <NairaInput {...p} value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} />}</Field>
          <Field label="Reason" required>{(p) => <Textarea {...p} rows={2} value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} />}</Field>
          {o.status === 'completed' && <Checkbox label="Items were returned: put them back into stock" checked={refund.restock} onChange={(e) => setRefund({ ...refund, restock: e.target.checked })} />}
        </div>
      </Dialog>
    </Card>
  );
}

function DeliveryCard({ o, reload }: { o: OrderDto; reload: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const { busy, run } = useAction();
  const delivery = useQuery({ queryKey: ['delivery', o.delivery?.id], queryFn: () => api.get<DeliveryDto>(`/deliveries/${o.delivery!.id}`), enabled: Boolean(o.delivery) });
  const [assigning, setAssigning] = useState(false);
  const [rider, setRider] = useState({ name: '', phone: '' });
  const canManage = Boolean(user?.permissions.includes(PERMISSIONS.DELIVERY_MANAGE));
  const d = delivery.data;
  if (!o.delivery) return null;

  return (
    <Card>
      <CardHeader title="Delivery" description={d ? DELIVERY_LABEL[d.status] : undefined} actions={canManage && d && ['pending', 'assigned', 'failed'].includes(d.status) && <Button size="sm" variant="secondary" onClick={() => setAssigning(true)}><Bike className="h-4 w-4" /> {d.assignedTo ? 'Change rider' : 'Assign rider'}</Button>} />
      <CardBody className="space-y-3 text-sm">
        {o.fulfilment.address && <p>{o.fulfilment.zone?.name}: {o.fulfilment.address.line1}{o.fulfilment.address.area ? `, ${o.fulfilment.address.area}` : ''}, {o.fulfilment.address.city}{o.fulfilment.address.landmark ? ` (${o.fulfilment.address.landmark})` : ''}</p>}
        {d?.assignedTo && <p>Rider: <strong>{d.assignedTo.name}</strong> · <a href={`tel:${d.assignedTo.phone}`} className="text-brand-700">{formatPhone(d.assignedTo.phone)}</a></p>}
        {canManage && d && DELIVERY_NEXT[d.status]!.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {DELIVERY_NEXT[d.status]!.map((s) => (
              <Button key={s} size="sm" variant={s === 'failed' || s === 'returned' ? 'danger-outline' : 'primary'} loading={busy === s} onClick={async () => {
                const ok = await run(s, async () => {
                  const r = await api.post<{ message: string | null }>(`/deliveries/${d.id}/status`, { status: s });
                  if (r.message) toast.success(r.message);
                });
                if (ok) { void delivery.refetch(); reload(); }
              }}>{DELIVERY_LABEL[s]}</Button>
            ))}
          </div>
        )}
        {d && d.status === 'pending' && o.status !== 'processing' && <p className="text-xs text-ink-muted">Assign a rider. The rider can leave once the order is being prepared.</p>}
      </CardBody>
      <Dialog open={assigning} onOpenChange={setAssigning} title="Assign a rider" size="sm"
        footer={<><Button variant="secondary" onClick={() => setAssigning(false)}>Cancel</Button><Button loading={busy === 'assign'} onClick={async () => {
          if (await run('assign', () => api.post(`/deliveries/${d!.id}/assign`, rider), 'Rider assigned')) { setAssigning(false); void delivery.refetch(); reload(); }
        }}>Assign</Button></>}>
        <div className="space-y-4">
          <Field label="Rider name" required>{(p) => <Input {...p} value={rider.name} onChange={(e) => setRider({ ...rider, name: e.target.value })} />}</Field>
          <Field label="Rider phone" required>{(p) => <Input {...p} type="tel" value={rider.phone} onChange={(e) => setRider({ ...rider, phone: e.target.value })} />}</Field>
        </div>
      </Dialog>
    </Card>
  );
}

export default function AdminOrderPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { busy, run } = useAction();
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api.get<OrderDto>(`/orders/${id}`) });
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const reload = () => { void order.refetch(); void qc.invalidateQueries({ queryKey: ['orders'] }); };

  const back = <Link href="/admin/orders" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Orders</Link>;
  if (order.isLoading) return <Skeleton className="h-96" />;
  if (order.error || !order.data) return <><PageHeader title="Order" back={back} /><Alert>{order.error ? errorMessage(order.error) : 'Not found'}</Alert></>;
  const o = order.data;
  const next = o.allowedTransitions[0];
  const blockedByPayment = next === 'completed' && o.outstanding > 0;
  const deliveryDrivesNext = next === 'out_for_delivery';

  const action = (label: ReactNode, to: OrderStatus) => (
    <Button key={to} loading={busy === to} disabled={to === 'completed' && o.outstanding > 0} onClick={() => run(to, () => api.post(`/orders/${id}/status`, { to }), `Order ${ORDER_STATUS[to].label.toLowerCase()}`).then(reload)}>{label}</Button>
  );

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={o.reference}
        back={back}
        description={<span className="inline-flex flex-wrap items-center gap-2"><OrderStatusBadge status={o.status} /> {o.branch.name} · {o.channel.replace('_', ' ')} · {formatDateTime(o.createdAt)}</span>}
        actions={
          <>
            <a href={`tel:${o.customer.phone}`} className={buttonClasses('secondary')}><Phone className="h-4 w-4" /> Call</a>
            <a href={`https://wa.me/${toWhatsAppNumber(o.customer.phone)}?text=${encodeURIComponent(`Hello ${o.customer.fullName.split(' ')[0]}, this is ${o.branch.name} about your order ${o.reference}. `)}`} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary')}><MessageCircle className="h-4 w-4" /> WhatsApp</a>
            <ButtonLink href={`/admin/orders/${o.id}/receipt`} variant="secondary"><Printer className="h-4 w-4" /> Receipt</ButtonLink>
            {o.canCancel && <Button variant="danger-outline" onClick={() => setCancelling(true)}>Cancel</Button>}
          </>
        }
      />

      {o.allowedTransitions.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 p-4">
          <p className="flex-1 text-sm"><strong>Next step:</strong> {deliveryDrivesNext ? 'assign a rider and mark the delivery as picked up (this dispatches the order).' : blockedByPayment ? 'record the payment, then complete the order.' : NEXT_LABEL[next!]}</p>
          {o.allowedTransitions.filter((t) => t !== 'out_for_delivery').map((t) => action(NEXT_LABEL[t], t))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Items" description={['pending', 'confirmed', 'processing', 'ready_for_pickup'].includes(o.status) ? 'Held in stock for this order.' : undefined} />
            <ul className="divide-y divide-line">
              {o.items.map((i) => (
                <li key={`${i.product.id}${i.variant?.id ?? ''}`} className="flex items-center gap-3 px-5 py-3">
                  <Thumb url={i.product.image} alt="" />
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{i.product.name}{i.variant && <span className="text-ink-muted"> · {i.variant.label}</span>}</p><p className="text-xs text-ink-muted">{i.sku} · {i.quantity} × {formatNaira(i.unitPrice)}</p></div>
                  <span className="font-semibold tabular-nums">{formatNaira(i.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <CardBody className="space-y-1.5 border-t border-line text-sm">
              <div className="flex justify-between"><span className="text-ink-muted">Subtotal</span><span>{formatNaira(o.subtotal)}</span></div>
              {o.discountTotal > 0 && <div className="flex justify-between text-success-700"><span>{o.promotion?.name}</span><span>−{formatNaira(o.discountTotal)}</span></div>}
              {o.fulfilment.method === 'delivery' && <div className="flex justify-between"><span className="text-ink-muted">Delivery</span><span>{o.deliveryFee ? formatNaira(o.deliveryFee) : 'Free'}</span></div>}
              <div className="flex justify-between text-base font-bold"><span>Total</span><span>{formatNaira(o.total)}</span></div>
            </CardBody>
          </Card>
          <PaymentsCard o={o} reload={reload} />
          <DeliveryCard o={o} reload={reload} />
        </div>
        <aside className="space-y-6">
          <Card>
            <CardHeader title="Customer" />
            <CardBody>
              <DescriptionList items={[
                { label: 'Name', value: <Link href={`/admin/customers/${o.customer.id}`} className="text-brand-700 hover:underline">{o.customer.fullName}</Link> },
                { label: 'Phone', value: formatPhone(o.customer.phone) },
                { label: 'Email', value: o.customer.email },
                { label: 'Payment choice', value: PAY[o.paymentMethod] },
              ]} />
              {o.note && <p className="mt-3 text-sm text-ink-muted">“{o.note}”</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <CardBody>
              <ol className="space-y-2 text-sm">{o.statusHistory.map((h, i) => <li key={i}><strong>{ORDER_STATUS[h.to].label}</strong> <span className="text-ink-muted">· {formatDateTime(h.at)}</span>{h.note && <p className="text-xs text-ink-faint">{h.note}</p>}</li>)}</ol>
            </CardBody>
          </Card>
        </aside>
      </div>

      <Dialog open={cancelling} onOpenChange={setCancelling} title={`Cancel ${o.reference}?`} description={o.amountPaid > 0 ? `The customer has paid ${formatNaira(o.amountPaid)}. Refund it from the payments panel after cancelling.` : 'Held stock is released straight away.'} size="sm"
        footer={<><Button variant="secondary" onClick={() => setCancelling(false)}>Back</Button><Button variant="danger" loading={busy === 'cancel'} onClick={async () => {
          if (await run('cancel', () => api.post(`/orders/${id}/cancel`, { reason: reason || undefined }), 'Order cancelled')) { setCancelling(false); reload(); }
        }}>Cancel order</Button></>}>
        <Field label="Reason (optional)">{(p) => <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </Dialog>
    </div>
  );
}
