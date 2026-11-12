'use client';

import { type OrderTrackingDto, type ReservationTrackingDto, formatNaira, normalizePhone, toWhatsAppNumber } from '@mb/shared';
import { CheckCircle2, MessageCircle, PackageSearch, Phone } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { RESERVATION_STATUS, ReservationStatusBadge } from '@/components/reservation-status';
import { OrderProgress, OrderStatusBadge } from '@/components/store/order-status';
import { BankTransferDetails, PayByCardButton } from '@/components/store/pay';
import { WhatsAppLink } from '@/components/store/whatsapp-link';
import { Button, buttonClasses } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/field';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

type Result = { kind: 'order'; data: OrderTrackingDto } | { kind: 'reservation'; data: ReservationTrackingDto };
const REF = /^(ORD|RSV)-[A-Z]{3}\d{2}-\d{6,}$/;

function Tracker() {
  const params = useSearchParams();
  const router = useRouter();
  const [reference, setReference] = useState(params.get('reference') ?? '');
  const [phone, setPhone] = useState(params.get('phone') ?? '');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const placed = params.get('placed') === '1';

  const lookup = async (ref = reference, ph = phone) => {
    setError(null);
    const r = ref.trim().toUpperCase();
    const p = normalizePhone(ph);
    if (!REF.test(r) || !p) return setError('Enter your order or reservation number (e.g. ORD-KAN01-260012) and the phone number you used.');
    setBusy(true);
    try {
      setResult(
        r.startsWith('ORD')
          ? { kind: 'order', data: await api.get<OrderTrackingDto>('/orders/track', { reference: r, phone: p }) }
          : { kind: 'reservation', data: await api.get<ReservationTrackingDto>('/reservations/track', { reference: r, phone: p }) },
      );
      router.replace(`/track?reference=${encodeURIComponent(r)}&phone=${encodeURIComponent(ph)}${placed ? '&placed=1' : ''}`, { scroll: false });
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError && err.status === 404 ? 'We could not find that number with that phone. Please check both.' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (params.get('reference') && params.get('phone')) void lookup(params.get('reference')!, params.get('phone')!);
  }, []);

  const branch = result?.data.branch;
  const ref = result?.data.reference ?? '';

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {placed && result?.kind === 'order' && (
        <div className="mb-8 rounded-xl border border-success-700/20 bg-success-50 p-6">
          <CheckCircle2 className="h-8 w-8 text-success-700" aria-hidden />
          <h1 className="mt-2 text-2xl font-bold">Thank you, your order is placed</h1>
          <p className="mt-1 text-sm text-ink-muted">Your order number is <strong className="text-ink">{ref}</strong>. Keep it with your phone number to check progress here.</p>
        </div>
      )}
      {!placed && <h1 className="text-3xl font-bold tracking-tight">Track an order or reservation</h1>}
      {!result && (
        <form className="mt-6 grid gap-4 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
          <Field label="Order or reservation number" required>{(p) => <Input {...p} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="ORD-KAN01-260012" className="uppercase" />}</Field>
          <Field label="Phone number used" required>{(p) => <Input {...p} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 123 4567" />}</Field>
          <div className="sm:col-span-2"><Button type="submit" loading={busy}><PackageSearch className="h-4 w-4" /> Track</Button></div>
        </form>
      )}
      {error && <Alert className="mt-4">{error}</Alert>}
      {result && branch && (
        <section className="space-y-6 rounded-xl border border-line bg-surface p-6" aria-label="Status">
          {result.kind === 'order' ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-ink-muted">Order</p>
                  <p className="text-xl font-bold">{ref}</p>
                  <p className="text-sm text-ink-muted">{result.data.itemCount} item{result.data.itemCount === 1 ? '' : 's'} · {formatNaira(result.data.total)} · {result.data.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}</p>
                </div>
                <OrderStatusBadge status={result.data.status} />
              </div>
              <OrderProgress status={result.data.status} fulfilment={result.data.fulfilment} history={result.data.history} />
              {result.data.status === 'pending' && (
                <div className="space-y-3">
                  <PayByCardButton reference={ref} phone={normalizePhone(phone) ?? undefined} amount={result.data.total} />
                  <BankTransferDetails amount={result.data.total} reference={ref} />
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-ink-muted">Reservation</p>
                <p className="text-xl font-bold">{ref}</p>
                <p className="text-sm text-ink-muted">{result.data.itemCount} item{result.data.itemCount === 1 ? '' : 's'}{result.data.expiresAt && ['pending', 'confirmed'].includes(result.data.status) ? ` held until ${formatDateTime(result.data.expiresAt)}` : ''}</p>
              </div>
              <ReservationStatusBadge status={result.data.status} />
              <p className="w-full text-sm text-ink-muted">
                {result.data.status === 'confirmed' ? 'Ready for you. Bring your reservation number to the branch and pay when you collect.' : result.data.status === 'pending' ? 'The branch will confirm shortly.' : RESERVATION_STATUS[result.data.status].label}
              </p>
            </div>
          )}
          <div className="rounded-lg bg-subtle p-4 text-sm">
            <p className="font-semibold">{branch.name}</p>
            <p className="text-ink-muted">{branch.address}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={`tel:${branch.phone}`} className={buttonClasses('secondary', 'sm')}><Phone className="h-4 w-4" /> Call branch</a>
              <WhatsAppLink context={result.kind} refId={ref} href={`https://wa.me/${toWhatsAppNumber(branch.whatsapp)}?text=${encodeURIComponent(`Hello, I am asking about my ${result.kind} ${ref}.`)}`} className={buttonClasses('primary', 'sm')}>
                <MessageCircle className="h-4 w-4" /> WhatsApp the branch
              </WhatsAppLink>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setResult(null); router.replace('/track'); }}>Track another</Button>
        </section>
      )}
    </div>
  );
}

export default function TrackPage() {
  return (
    // The fallback is server-rendered, so the heading paints before JavaScript loads.
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-3xl font-bold tracking-tight">Track an order or reservation</h1>
          <div className="mt-6 h-40 rounded-xl border border-line bg-surface" aria-hidden />
        </div>
      }
    >
      <Tracker />
    </Suspense>
  );
}
