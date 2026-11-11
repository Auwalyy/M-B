'use client';

import { type OrderTrackingDto, formatNaira, normalizePhone, toWhatsAppNumber } from '@mb/shared';
import { CheckCircle2, MessageCircle, PackageSearch, Phone } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { OrderProgress, OrderStatusBadge } from '@/components/store/order-status';
import { Button, buttonClasses } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/field';
import { ApiError, api, errorMessage } from '@/lib/api';

function Tracker() {
  const params = useSearchParams();
  const router = useRouter();
  const [reference, setReference] = useState(params.get('reference') ?? '');
  const [phone, setPhone] = useState(params.get('phone') ?? '');
  const [order, setOrder] = useState<OrderTrackingDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const placed = params.get('placed') === '1';

  const lookup = async (ref = reference, ph = phone) => {
    setError(null);
    const p = normalizePhone(ph);
    if (!/^ORD-[A-Z]{3}\d{2}-\d{6,}$/i.test(ref.trim()) || !p) return setError('Enter your order number (e.g. ORD-KAN01-260012) and the phone number used when ordering.');
    setBusy(true);
    try {
      setOrder(await api.get<OrderTrackingDto>('/orders/track', { reference: ref.trim().toUpperCase(), phone: p }));
      router.replace(`/track?reference=${encodeURIComponent(ref.trim().toUpperCase())}&phone=${encodeURIComponent(ph)}${placed ? '&placed=1' : ''}`, { scroll: false });
    } catch (err) {
      setOrder(null);
      setError(err instanceof ApiError && err.status === 404 ? 'We could not find an order with that number and phone. Please check both.' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (params.get('reference') && params.get('phone')) void lookup(params.get('reference')!, params.get('phone')!);
    // Runs once on first load, using the parameters in the link.
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {placed && order && (
        <div className="mb-8 rounded-xl border border-success-700/20 bg-success-50 p-6">
          <CheckCircle2 className="h-8 w-8 text-success-700" aria-hidden />
          <h1 className="mt-2 text-2xl font-bold">Thank you, your order is placed</h1>
          <p className="mt-1 text-sm text-ink-muted">Your order number is <strong className="text-ink">{order.reference}</strong>. Keep it with your phone number to check progress here.</p>
        </div>
      )}
      {!placed && <h1 className="text-3xl font-bold tracking-tight">Track your order</h1>}
      {!order && (
        <form className="mt-6 grid gap-4 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
          <Field label="Order number" required>{(p) => <Input {...p} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="ORD-KAN01-260012" className="uppercase" />}</Field>
          <Field label="Phone number used" required>{(p) => <Input {...p} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 123 4567" />}</Field>
          <div className="sm:col-span-2"><Button type="submit" loading={busy}><PackageSearch className="h-4 w-4" /> Track order</Button></div>
        </form>
      )}
      {error && <Alert className="mt-4">{error}</Alert>}
      {order && (
        <section className="space-y-6 rounded-xl border border-line bg-surface p-6" aria-label="Order status">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-ink-muted">Order</p>
              <p className="text-xl font-bold">{order.reference}</p>
              <p className="text-sm text-ink-muted">{order.itemCount} item{order.itemCount === 1 ? '' : 's'} · {formatNaira(order.total)} · {order.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}</p>
            </div>
            <OrderStatusBadge status={order.status} />
          </div>
          <OrderProgress status={order.status} fulfilment={order.fulfilment} history={order.history} />
          <div className="rounded-lg bg-subtle p-4 text-sm">
            <p className="font-semibold">{order.branch.name}</p>
            <p className="text-ink-muted">{order.branch.address}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={`tel:${order.branch.phone}`} className={buttonClasses('secondary', 'sm')}><Phone className="h-4 w-4" /> Call branch</a>
              <a href={`https://wa.me/${toWhatsAppNumber(order.branch.whatsapp)}?text=${encodeURIComponent(`Hello, I am asking about my order ${order.reference}.`)}`} target="_blank" rel="noopener noreferrer" className={buttonClasses('primary', 'sm')}>
                <MessageCircle className="h-4 w-4" /> WhatsApp about this order
              </a>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setOrder(null); router.replace('/track'); }}>Track another order</Button>
        </section>
      )}
    </div>
  );
}

export default function TrackPage() {
  return (
    <Suspense>
      <Tracker />
    </Suspense>
  );
}
