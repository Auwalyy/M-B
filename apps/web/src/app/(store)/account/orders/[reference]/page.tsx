'use client';

import { type OrderDto, formatNaira, toWhatsAppNumber } from '@mb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { OrderProgress, OrderStatusBadge } from '@/components/store/order-status';
import { Button, buttonClasses } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/display';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, imageUrl } from '@/lib/utils';

const PAY_LABEL: Record<string, string> = { pay_on_pickup: 'Pay at the branch', pay_on_delivery: 'Pay on delivery', bank_transfer: 'Bank transfer', paystack: 'Card (Paystack)', cash: 'Cash' };

function OrderDetail() {
  const { reference } = useParams<{ reference: string }>();
  const placed = useSearchParams().get('placed') === '1';
  const { status } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const order = useQuery({ queryKey: ['my-order', reference], queryFn: () => api.get<OrderDto>(`/orders/mine/${reference}`), enabled: status === 'authenticated' });

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=/account/orders/${reference}`);
  }, [status, router, reference]);

  if (order.isLoading || status === 'loading') return <Skeleton className="h-96" />;
  if (order.error || !order.data) return <Alert>{order.error ? errorMessage(order.error) : 'Order not found'}</Alert>;
  const o = order.data;

  return (
    <div className="space-y-6">
      <Link href="/account" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> My account</Link>
      {placed && (
        <div className="rounded-xl border border-success-700/20 bg-success-50 p-5">
          <CheckCircle2 className="h-7 w-7 text-success-700" aria-hidden />
          <h1 className="mt-2 text-xl font-bold">Thank you, your order is placed</h1>
          <p className="text-sm text-ink-muted">{o.fulfilment.method === 'pickup' ? `${o.branch.name} will let you know when it is ready to collect.` : `${o.branch.name} will contact you to arrange delivery.`}</p>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{o.reference}</h2>
          <p className="text-sm text-ink-muted">Placed {formatDateTime(o.createdAt)} · {o.branch.name}</p>
        </div>
        <OrderStatusBadge status={o.status} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <section className="rounded-xl border border-line bg-surface">
          <ul className="divide-y divide-line">
            {o.items.map((i) => (
              <li key={`${i.product.id}${i.variant?.id ?? ''}`} className="flex gap-3 p-4">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-line bg-subtle">{i.product.image && <img src={imageUrl(i.product.image, 112)!} alt="" className="h-full w-full object-contain" />}</div>
                <div className="min-w-0 flex-1">
                  <Link href={`/products/${i.product.slug}`} className="font-medium hover:text-brand-700">{i.product.name}</Link>
                  {i.variant && <p className="text-sm text-ink-muted">{i.variant.label}</p>}
                  <p className="text-sm text-ink-muted">{i.quantity} × {formatNaira(i.unitPrice)}</p>
                </div>
                <p className="font-semibold tabular-nums">{formatNaira(i.lineTotal)}</p>
              </li>
            ))}
          </ul>
          <dl className="space-y-1.5 border-t border-line p-4 text-sm">
            <div className="flex justify-between"><dt className="text-ink-muted">Subtotal</dt><dd>{formatNaira(o.subtotal)}</dd></div>
            {o.discountTotal > 0 && <div className="flex justify-between text-success-700"><dt>{o.promotion?.name ?? 'Discount'}</dt><dd>−{formatNaira(o.discountTotal)}</dd></div>}
            {o.fulfilment.method === 'delivery' && <div className="flex justify-between"><dt className="text-ink-muted">Delivery ({o.fulfilment.zone?.name})</dt><dd>{o.deliveryFee ? formatNaira(o.deliveryFee) : 'Free'}</dd></div>}
            <div className="flex justify-between text-base font-bold"><dt>Total</dt><dd>{formatNaira(o.total)}</dd></div>
            <div className="flex justify-between text-ink-muted"><dt>Payment</dt><dd>{PAY_LABEL[o.paymentMethod]} · {o.paymentStatus === 'paid' ? 'Paid' : 'Not paid yet'}</dd></div>
          </dl>
        </section>
        <aside className="space-y-4">
          <div className="rounded-xl border border-line bg-surface p-4">
            <OrderProgress status={o.status} fulfilment={o.fulfilment.method} history={o.statusHistory.map((h) => ({ status: h.to, at: h.at }))} />
          </div>
          {o.fulfilment.address && (
            <div className="rounded-xl border border-line bg-surface p-4 text-sm">
              <p className="font-semibold">Delivering to</p>
              <p className="text-ink-muted">{o.fulfilment.address.line1}{o.fulfilment.address.area ? `, ${o.fulfilment.address.area}` : ''}, {o.fulfilment.address.city}, {o.fulfilment.address.state}</p>
            </div>
          )}
          <a href={`https://wa.me/${toWhatsAppNumber(o.branch.whatsapp)}?text=${encodeURIComponent(`Hello, I am asking about my order ${o.reference}.`)}`} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'md', 'w-full')}>
            <MessageCircle className="h-4 w-4" /> Ask the branch on WhatsApp
          </a>
          {o.canCancel && (
            <ConfirmDialog
              title="Cancel this order?"
              description="The items are released for other customers. This cannot be undone."
              confirmLabel="Cancel order"
              onConfirm={async () => {
                try {
                  qc.setQueryData(['my-order', reference], await api.post<OrderDto>(`/orders/mine/${reference}/cancel`, {}));
                  void qc.invalidateQueries({ queryKey: ['my-orders'] });
                  toast.success('Order cancelled');
                } catch (err) {
                  toast.error(errorMessage(err));
                  throw err;
                }
              }}
              trigger={(open) => <Button variant="danger-outline" className="w-full" onClick={open}>Cancel order</Button>}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

export default function OrderPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Suspense>
        <OrderDetail />
      </Suspense>
    </div>
  );
}
