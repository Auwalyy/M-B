'use client';

import { formatNaira } from '@mb/shared';
import { useQuery } from '@tanstack/react-query';
import { Minus, Package, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Price } from '@/components/store/product-card';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert, EmptyState, Skeleton } from '@/components/ui/display';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useCart } from '@/lib/cart';
import { cn, imageUrl } from '@/lib/utils';

export default function CartPage() {
  const { cart, loading, setItem, setBranch, busy } = useCart();
  const toast = useToast();
  const branches = useQuery({ queryKey: ['branches', 'public'], queryFn: () => api.get<{ id: string; name: string; city: string; services: { pickup: boolean; delivery: boolean } }[]>('/branches') });

  const change = async (product: string, variant: string | null, quantity: number) => {
    try {
      await setItem(product, variant, quantity);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (loading) return <div className="mx-auto max-w-5xl space-y-4 px-4 py-10"><Skeleton className="h-8 w-40" /><Skeleton className="h-40" /></div>;
  if (!cart || cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <EmptyState icon={ShoppingBag} title="Your cart is empty" description="Browse our products and add what you need." action={<ButtonLink href="/shop">Start shopping</ButtonLink>} />
      </div>
    );
  }
  const problems = cart.lines.filter((l) => l.problem);
  const canCheckout = Boolean(cart.branch) && problems.length === 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Your cart</h1>
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="branch-h">
            <h2 id="branch-h" className="text-sm font-semibold">Order from</h2>
            <p className="text-xs text-ink-muted">Each order is prepared by one branch. Stock is checked at the branch you choose.</p>
            <select
              aria-labelledby="branch-h"
              className="mt-2 h-10 w-full rounded-lg border border-line-strong bg-surface px-2 text-sm"
              value={cart.branch?.id ?? ''}
              disabled={busy}
              onChange={(e) => setBranch(e.target.value).catch((err) => toast.error(errorMessage(err)))}
            >
              {!cart.branch && <option value="">Choose a branch</option>}
              {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}{b.services.delivery ? '' : ' (pickup only)'}</option>)}
            </select>
          </section>

          {problems.length > 0 && <Alert kind="warning" title="Some items need attention">Change the quantity, remove the item, or choose another branch.</Alert>}

          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {cart.lines.map((l) => {
              const img = imageUrl(l.product.image?.url, 160);
              const [product, variant] = [l.product.id, l.variant?.id ?? null];
              return (
                <li key={l.key} className="flex gap-4 p-4">
                  {/* The product name beside it is the link for screen readers; this thumbnail is a mouse shortcut. */}
                  <Link href={l.product.slug ? `/products/${l.product.slug}` : '#'} tabIndex={-1} aria-hidden className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-line bg-subtle">
                    {img ? <img src={img} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" /> : <Package className="m-auto mt-6 h-8 w-8 text-ink-faint" aria-hidden />}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={`/products/${l.product.slug}`} className="font-semibold hover:text-brand-700">{l.product.name}</Link>
                    {l.variant && <p className="text-sm text-ink-muted">{l.variant.label}</p>}
                    <div className="mt-1"><Price price={l.compareAtPrice ?? l.unitPrice} discountPrice={l.compareAtPrice ? l.unitPrice : null} /></div>
                    {l.problem && <p className="mt-1 text-sm font-medium text-danger-700" role="alert">{l.problem}</p>}
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex items-center rounded-lg border border-line-strong" role="group" aria-label={`Quantity of ${l.product.name}`}>
                        <button className="flex h-9 w-9 items-center justify-center disabled:opacity-40" disabled={busy || l.quantity <= 1} onClick={() => change(product, variant, l.quantity - 1)} aria-label="Fewer"><Minus className="h-4 w-4" /></button>
                        <span className="w-8 text-center text-sm font-semibold tabular-nums">{l.quantity}</span>
                        <button className="flex h-9 w-9 items-center justify-center disabled:opacity-40" disabled={busy || l.quantity >= 100} onClick={() => change(product, variant, l.quantity + 1)} aria-label="More"><Plus className="h-4 w-4" /></button>
                      </div>
                      <button className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-danger-700" disabled={busy} onClick={() => change(product, variant, 0)}>
                        <Trash2 className="h-4 w-4" /> Remove
                      </button>
                    </div>
                  </div>
                  <p className="font-bold tabular-nums">{formatNaira(l.lineTotal)}</p>
                </li>
              );
            })}
          </ul>
        </div>

        <aside className="h-fit space-y-4 rounded-xl border border-line bg-surface p-5 lg:sticky lg:top-24">
          <h2 className="font-semibold">Summary</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-ink-muted">Items ({cart.itemCount})</dt><dd className="font-semibold tabular-nums">{formatNaira(cart.subtotal)}</dd></div>
            <div className="flex justify-between text-ink-muted"><dt>Delivery and promotions</dt><dd>At checkout</dd></div>
          </dl>
          <ButtonLink href="/checkout" size="lg" className={cn('w-full', !canCheckout && 'pointer-events-none opacity-50')} aria-disabled={!canCheckout}>
            Continue to checkout
          </ButtonLink>
          {!cart.branch && <p className="text-xs text-danger-700">Choose a branch first.</p>}
          <Button variant="ghost" className="w-full" onClick={() => history.back()}>Continue shopping</Button>
        </aside>
      </div>
    </div>
  );
}
