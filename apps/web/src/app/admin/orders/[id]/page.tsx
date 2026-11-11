'use client';

import { type OrderDto, formatNaira, formatPhone, toWhatsAppNumber } from '@mb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageCircle, Phone } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Thumb } from '@/components/admin/commerce';
import { ORDER_STATUS, OrderStatusBadge } from '@/components/store/order-status';
import { Button, buttonClasses } from '@/components/ui/button';
import { Alert, Card, CardBody, CardHeader, DescriptionList, PageHeader, Skeleton } from '@/components/ui/display';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

const PAY: Record<string, string> = { pay_on_pickup: 'Pay at branch', pay_on_delivery: 'Pay on delivery', bank_transfer: 'Bank transfer', paystack: 'Card (Paystack)', cash: 'Cash' };

export default function AdminOrderPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const order = useQuery({ queryKey: ['order', id], queryFn: () => api.get<OrderDto>(`/orders/${id}`) });
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const back = <Link href="/admin/orders" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Orders</Link>;
  if (order.isLoading) return <Skeleton className="h-96" />;
  if (order.error || !order.data) return <><PageHeader title="Order" back={back} /><Alert>{order.error ? errorMessage(order.error) : 'Not found'}</Alert></>;
  const o = order.data;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={o.reference}
        back={back}
        description={<span className="inline-flex flex-wrap items-center gap-2"><OrderStatusBadge status={o.status} /> {o.branch.name} · {formatDateTime(o.createdAt)}</span>}
        actions={
          <>
            <a href={`tel:${o.customer.phone}`} className={buttonClasses('secondary')}><Phone className="h-4 w-4" /> Call</a>
            <a href={`https://wa.me/${toWhatsAppNumber(o.customer.phone)}?text=${encodeURIComponent(`Hello ${o.customer.fullName.split(' ')[0]}, this is ${o.branch.name} about your order ${o.reference}. `)}`} target="_blank" rel="noopener noreferrer" className={buttonClasses('primary')}>
              <MessageCircle className="h-4 w-4" /> WhatsApp customer
            </a>
            {o.canCancel && <Button variant="danger-outline" onClick={() => setCancelling(true)}>Cancel order</Button>}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader title="Items" description={o.status !== 'cancelled' ? 'These units are held in stock for this order.' : undefined} />
          <ul className="divide-y divide-line">
            {o.items.map((i) => (
              <li key={`${i.product.id}${i.variant?.id ?? ''}`} className="flex items-center gap-3 px-5 py-3">
                <Thumb url={i.product.image} alt="" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{i.product.name}{i.variant && <span className="text-ink-muted"> · {i.variant.label}</span>}</p>
                  <p className="text-xs text-ink-muted">{i.sku} · {i.quantity} × {formatNaira(i.unitPrice)}</p>
                </div>
                <span className="font-semibold tabular-nums">{formatNaira(i.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <CardBody className="space-y-1.5 border-t border-line text-sm">
            <div className="flex justify-between"><span className="text-ink-muted">Subtotal</span><span>{formatNaira(o.subtotal)}</span></div>
            {o.discountTotal > 0 && <div className="flex justify-between text-success-700"><span>{o.promotion?.name}{o.promotion?.code ? ` (${o.promotion.code})` : ''}</span><span>−{formatNaira(o.discountTotal)}</span></div>}
            {o.fulfilment.method === 'delivery' && <div className="flex justify-between"><span className="text-ink-muted">Delivery</span><span>{o.deliveryFee ? formatNaira(o.deliveryFee) : 'Free'}</span></div>}
            <div className="flex justify-between text-base font-bold"><span>Total</span><span>{formatNaira(o.total)}</span></div>
          </CardBody>
        </Card>
        <aside className="space-y-6">
          <Card>
            <CardHeader title="Customer" />
            <CardBody>
              <DescriptionList items={[
                { label: 'Name', value: <Link href={`/admin/customers/${o.customer.id}`} className="text-brand-700 hover:underline">{o.customer.fullName}</Link> },
                { label: 'Phone', value: formatPhone(o.customer.phone) },
                { label: 'Email', value: o.customer.email },
                { label: 'Payment', value: `${PAY[o.paymentMethod]} · ${o.paymentStatus === 'paid' ? 'paid' : 'not paid'}` },
              ]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={o.fulfilment.method === 'pickup' ? 'Pickup' : 'Delivery'} />
            <CardBody className="text-sm">
              {o.fulfilment.address ? (
                <p>{o.fulfilment.zone?.name}: {o.fulfilment.address.line1}{o.fulfilment.address.area ? `, ${o.fulfilment.address.area}` : ''}, {o.fulfilment.address.city}, {o.fulfilment.address.state}{o.fulfilment.address.landmark ? ` (${o.fulfilment.address.landmark})` : ''}</p>
              ) : (
                <p>Customer collects at {o.branch.name}.</p>
              )}
              {o.note && <p className="mt-2 text-ink-muted">“{o.note}”</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <CardBody>
              <ol className="space-y-2 text-sm">
                {o.statusHistory.map((h, i) => <li key={i}><strong>{ORDER_STATUS[h.to].label}</strong> <span className="text-ink-muted">· {formatDateTime(h.at)}</span>{h.note && <p className="text-xs text-ink-faint">{h.note}</p>}</li>)}
              </ol>
            </CardBody>
          </Card>
        </aside>
      </div>
      <Dialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel ${o.reference}?`}
        description="The held stock is released straight away. Let the customer know."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(false)}>Back</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  qc.setQueryData(['order', id], await api.post<OrderDto>(`/orders/${id}/cancel`, { reason: reason || undefined }));
                  void qc.invalidateQueries({ queryKey: ['orders'] });
                  toast.success('Order cancelled');
                  setCancelling(false);
                } catch (err) {
                  toast.error(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Cancel order
            </Button>
          </>
        }
      >
        <Field label="Reason (optional)">{(p) => <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </Dialog>
    </div>
  );
}
