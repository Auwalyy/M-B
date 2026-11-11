'use client';

import {
  type CheckoutPaymentMethod,
  type DeliveryZoneDto,
  NIGERIAN_STATES,
  type OrderDto,
  type QuoteDto,
  checkoutSchema,
  formatNaira,
  formatPhone,
} from '@mb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Store, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CART_KEY, useCart } from '@/lib/cart';
import { cn } from '@/lib/utils';

const PAYMENT: Record<CheckoutPaymentMethod, { label: string; help: string }> = {
  pay_on_pickup: { label: 'Pay at the branch', help: 'Cash, card or transfer when you collect.' },
  pay_on_delivery: { label: 'Pay on delivery', help: 'Pay the rider by card, transfer or cash.' },
  bank_transfer: { label: 'Bank transfer', help: 'The branch will send account details to confirm your order.' },
};

export default function CheckoutPage() {
  const { user, status } = useAuth();
  const { cart, loading } = useCart();
  const qc = useQueryClient();
  const router = useRouter();
  const idempotencyKey = useRef(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [fulfilment, setFulfilment] = useState<'pickup' | 'delivery'>('pickup');
  const [zone, setZone] = useState('');
  const [promoInput, setPromoInput] = useState('');
  const [promoCode, setPromoCode] = useState<string | undefined>();
  const [payment, setPayment] = useState<CheckoutPaymentMethod>('pay_on_pickup');
  const [contact, setContact] = useState({ fullName: '', phone: '', email: '' });
  const [address, setAddress] = useState({ line1: '', area: '', city: '', state: 'Kano', landmark: '' });
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    if (user) setContact((c) => ({ fullName: c.fullName || user.fullName, phone: c.phone || (user.phone ? formatPhone(user.phone) : ''), email: c.email || (user.email ?? '') }));
  }, [user]);
  useEffect(() => setPayment(fulfilment === 'pickup' ? 'pay_on_pickup' : 'pay_on_delivery'), [fulfilment]);
  useEffect(() => {
    if (cart?.branch && !cart.branch.pickup && cart.branch.delivery) setFulfilment('delivery');
  }, [cart?.branch]);

  const branchId = cart?.branch?.id;
  const zones = useQuery({ queryKey: ['zones', branchId], queryFn: () => api.get<DeliveryZoneDto[]>('/delivery-zones', { branch: branchId }), enabled: Boolean(branchId) });
  const quoteInput = useDeferredValue({ fulfilment, deliveryZone: fulfilment === 'delivery' && zone ? zone : undefined, promoCode });
  const quote = useQuery({
    queryKey: ['quote', quoteInput, cart?.itemCount, cart?.subtotal, branchId],
    queryFn: () => api.post<QuoteDto>('/checkout/quote', quoteInput),
    enabled: Boolean(cart?.lines.length),
  });

  if (loading || status === 'loading') return <div className="mx-auto max-w-5xl px-4 py-10"><Skeleton className="h-96" /></div>;
  if (!cart?.lines.length) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Your cart is empty</h1>
        <ButtonLink href="/shop" className="mt-6">Go shopping</ButtonLink>
      </div>
    );
  }

  const q = quote.data;
  const place = async () => {
    setFormError(null);
    const body = {
      fulfilment,
      deliveryZone: fulfilment === 'delivery' ? zone || undefined : undefined,
      promoCode,
      contact: { fullName: contact.fullName, phone: contact.phone, email: contact.email.trim() || undefined },
      deliveryAddress: fulfilment === 'delivery' ? { line1: address.line1, area: address.area || undefined, city: address.city, state: address.state, landmark: address.landmark || undefined } : undefined,
      paymentMethod: payment,
      note: note || undefined,
      idempotencyKey: idempotencyKey.current,
    };
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const i of parsed.error.issues) e[i.path.join('.')] ??= i.message;
      setErrors(e);
      setFormError('Please check the highlighted details.');
      return;
    }
    setErrors({});
    setPlacing(true);
    try {
      const order = await api.post<OrderDto>('/checkout', body);
      qc.setQueryData(CART_KEY, { ...cart, lines: [], itemCount: 0, subtotal: 0 });
      void qc.invalidateQueries({ queryKey: CART_KEY });
      router.replace(user ? `/account/orders/${order.reference}?placed=1` : `/track?reference=${order.reference}&phone=${encodeURIComponent(contact.phone)}&placed=1`);
    } catch (err) {
      setFormError(err instanceof ApiError && err.code === 'CHECKOUT_PROBLEMS' ? `${err.message} Please review your cart.` : errorMessage(err));
      void quote.refetch();
      setPlacing(false);
    }
  };

  const set = <T extends object>(setter: (v: T) => void, obj: T, k: keyof T) => (e: { target: { value: string } }) => setter({ ...obj, [k]: e.target.value });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Checkout</h1>
      {!user && (
        <p className="mt-2 text-sm text-ink-muted">
          Checking out as a guest. <Link href="/login?next=/checkout" className="font-semibold text-brand-700 underline">Sign in</Link> to see this order in your account later.
        </p>
      )}
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {formError && <Alert>{formError}</Alert>}

          <section className="rounded-xl border border-line bg-surface p-5" aria-labelledby="h-contact">
            <h2 id="h-contact" className="font-semibold">Your details</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Full name" error={errors['contact.fullName']} required className="sm:col-span-2">{(p) => <Input {...p} autoComplete="name" value={contact.fullName} onChange={set(setContact, contact, 'fullName')} />}</Field>
              <Field label="Phone number" error={errors['contact.phone']} required hint="For order updates. Also needed to track the order.">{(p) => <Input {...p} type="tel" autoComplete="tel" value={contact.phone} onChange={set(setContact, contact, 'phone')} />}</Field>
              <Field label="Email (optional)" error={errors['contact.email']} hint="We email your receipt here.">{(p) => <Input {...p} type="email" autoComplete="email" value={contact.email} onChange={set(setContact, contact, 'email')} />}</Field>
            </div>
          </section>

          <section className="rounded-xl border border-line bg-surface p-5" aria-labelledby="h-ful">
            <h2 id="h-ful" className="font-semibold">How do you want to receive it?</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(['pickup', 'delivery'] as const).map((m) => {
                const enabled = m === 'pickup' ? cart.branch?.pickup : cart.branch?.delivery;
                const Icon = m === 'pickup' ? Store : Truck;
                return (
                  <label key={m} className={cn('flex cursor-pointer gap-3 rounded-lg border p-4', fulfilment === m ? 'border-brand-600 bg-brand-50/50 ring-1 ring-brand-600' : 'border-line', !enabled && 'cursor-not-allowed opacity-50')}>
                    <input type="radio" name="fulfilment" className="mt-1 accent-brand-700" checked={fulfilment === m} disabled={!enabled} onChange={() => setFulfilment(m)} />
                    <Icon className="mt-0.5 h-5 w-5 text-brand-600" aria-hidden />
                    <span>
                      <span className="block text-sm font-semibold">{m === 'pickup' ? 'Pick up at the branch' : 'Home delivery'}</span>
                      <span className="text-xs text-ink-muted">{m === 'pickup' ? `${cart.branch?.name}. Free.` : enabled ? 'Fee depends on your area.' : 'Not offered by this branch.'}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {fulfilment === 'delivery' && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Delivery area" error={errors.deliveryZone} required className="sm:col-span-2">
                  {(p) => (
                    <Select {...p} value={zone} onChange={(e) => setZone(e.target.value)}>
                      <option value="">Choose your area</option>
                      {zones.data?.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name} · {z.fee ? formatNaira(z.fee) : 'free'}{z.freeAbove ? ` (free above ${formatNaira(z.freeAbove)})` : ''} · {z.estimatedDays ? `${z.estimatedDays} day${z.estimatedDays === 1 ? '' : 's'}` : 'same day'}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {zones.data?.length === 0 && <Alert kind="info" className="sm:col-span-2">This branch has not set up delivery areas yet. Choose pickup, or contact the branch.</Alert>}
                <Field label="Street address" error={errors['deliveryAddress.line1'] ?? errors.deliveryAddress} required className="sm:col-span-2">{(p) => <Input {...p} autoComplete="street-address" value={address.line1} onChange={set(setAddress, address, 'line1')} />}</Field>
                <Field label="Area">{(p) => <Input {...p} value={address.area} onChange={set(setAddress, address, 'area')} />}</Field>
                <Field label="City" error={errors['deliveryAddress.city']} required>{(p) => <Input {...p} autoComplete="address-level2" value={address.city} onChange={set(setAddress, address, 'city')} />}</Field>
                <Field label="State">{(p) => <Select {...p} value={address.state} onChange={set(setAddress, address, 'state')}>{NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>}</Field>
                <Field label="Landmark">{(p) => <Input {...p} value={address.landmark} onChange={set(setAddress, address, 'landmark')} placeholder="Near the mosque, opposite…" />}</Field>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-line bg-surface p-5" aria-labelledby="h-pay">
            <h2 id="h-pay" className="font-semibold">Payment</h2>
            <div className="mt-4 space-y-2">
              {(fulfilment === 'pickup' ? (['pay_on_pickup', 'bank_transfer'] as const) : (['pay_on_delivery', 'bank_transfer'] as const)).map((m) => (
                <label key={m} className={cn('flex cursor-pointer gap-3 rounded-lg border p-3', payment === m ? 'border-brand-600 bg-brand-50/50' : 'border-line')}>
                  <input type="radio" name="payment" className="mt-1 accent-brand-700" checked={payment === m} onChange={() => setPayment(m)} />
                  <span><span className="block text-sm font-semibold">{PAYMENT[m].label}</span><span className="text-xs text-ink-muted">{PAYMENT[m].help}</span></span>
                </label>
              ))}
              {errors.paymentMethod && <p role="alert" className="text-xs text-danger-700">{errors.paymentMethod}</p>}
              <p className="text-xs text-ink-faint">Online card payment is coming soon.</p>
            </div>
            <Field label="Note for the branch (optional)" className="mt-4">{(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          </section>
        </div>

        <aside className="h-fit space-y-4 rounded-xl border border-line bg-surface p-5 lg:sticky lg:top-24" aria-live="polite">
          <h2 className="font-semibold">Order from {cart.branch?.name ?? '—'}</h2>
          <ul className="space-y-2 text-sm">
            {cart.lines.map((l) => (
              <li key={l.key} className="flex justify-between gap-3"><span className="min-w-0 truncate">{l.quantity} × {l.product.name}{l.variant ? ` (${l.variant.label})` : ''}</span><span className="tabular-nums">{formatNaira(l.lineTotal)}</span></li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setPromoCode(promoInput.trim().toUpperCase() || undefined);
            }}
          >
            <Input aria-label="Promo code" placeholder="Promo code" value={promoInput} onChange={(e) => setPromoInput(e.target.value)} className="h-9 uppercase" />
            <Button type="submit" size="sm" variant="secondary">Apply</Button>
          </form>
          {q?.promoMessage && <p className="text-xs text-danger-700" role="alert">{q.promoMessage}</p>}
          {quote.isLoading ? (
            <Skeleton className="h-24" />
          ) : q ? (
            <dl className="space-y-2 border-t border-line pt-3 text-sm">
              <div className="flex justify-between"><dt className="text-ink-muted">Subtotal</dt><dd className="tabular-nums">{formatNaira(q.subtotal)}</dd></div>
              {q.discount > 0 && <div className="flex justify-between text-success-700"><dt>{q.promotion?.name}</dt><dd className="tabular-nums">−{formatNaira(q.discount)}</dd></div>}
              {fulfilment === 'delivery' && (
                <div className="flex justify-between"><dt className="text-ink-muted">Delivery{q.promotion && q.deliveryFee === 0 && q.discount === 0 ? ` (${q.promotion.name})` : ''}</dt><dd className="tabular-nums">{q.deliveryZone ? (q.deliveryFee ? formatNaira(q.deliveryFee) : 'Free') : '—'}</dd></div>
              )}
              <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Total</dt><dd className="tabular-nums">{formatNaira(q.total)}</dd></div>
            </dl>
          ) : quote.error ? (
            <Alert>{errorMessage(quote.error)}</Alert>
          ) : null}
          {q && q.problems.length > 0 && (
            <Alert kind="warning" title="Before you order">
              <ul className="list-disc pl-4">{q.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              <Link href="/cart" className="mt-1 inline-block font-semibold underline">Back to cart</Link>
            </Alert>
          )}
          <Button size="lg" className="w-full" loading={placing} disabled={!q || q.problems.filter((p) => !/delivery area/.test(p)).length > 0} onClick={place}>
            <Lock className="h-4 w-4" /> Place order
          </Button>
          <p className="text-xs text-ink-faint">The items are held for you as soon as you place the order. You can cancel before the branch starts preparing it.</p>
        </aside>
      </div>
    </div>
  );
}
