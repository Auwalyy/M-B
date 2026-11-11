'use client';

import type { BranchAvailabilityDto, PublicProductDto, StockLevel } from '@mb/shared';
import { CalendarClock, Check, MapPin, MessageCircle, Minus, Plus, ShoppingBag } from 'lucide-react';
import { WhatsAppLink } from '@/components/store/whatsapp-link';
import { ReserveDialog } from './reserve-dialog';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { whatsappLink } from '@/components/store/branch-card';
import { Price } from '@/components/store/product-card';
import { Button, buttonClasses } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api';
import { useCart } from '@/lib/cart';
import { cn } from '@/lib/utils';

const LEVEL_TEXT: Record<StockLevel, { label: string; cls: string }> = {
  in_stock: { label: 'In stock', cls: 'text-success-700' },
  low: { label: 'Only a few left', cls: 'text-warning-700' },
  out: { label: 'Out of stock', cls: 'text-ink-faint' },
};

export function Purchase({ product, availability, companyName }: { product: PublicProductDto; availability: BranchAvailabilityDto[]; companyName: string }) {
  const { cart, setItem, setBranch, busy } = useCart();
  const toast = useToast();
  const [variantId, setVariantId] = useState<string | null>(product.hasVariants ? null : '');
  const [branchId, setBranchId] = useState<string>('');
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [reserving, setReserving] = useState(false);

  // Default to the branch already chosen in the cart, else the first branch that has stock.
  useEffect(() => {
    if (branchId) return;
    const fromCart = cart?.branch?.id;
    setBranchId(fromCart ?? availability.find((a) => a.level !== 'out')?.branch.id ?? availability[0]?.branch.id ?? '');
  }, [cart?.branch?.id, availability, branchId]);

  const variant = product.variants.find((v) => v.id === variantId) ?? null;
  const price = variant ? { price: variant.price ?? product.price, discountPrice: variant.discountPrice ?? (variant.price == null ? product.discountPrice : null) } : { price: product.price, discountPrice: product.discountPrice };
  const key = product.hasVariants ? variantId ?? null : '';
  const levelAt = (a: BranchAvailabilityDto): StockLevel => (key === null ? a.level : (a.levels[key] ?? 'out'));
  const selected = availability.find((a) => a.branch.id === branchId);
  const selectedLevel = selected ? levelAt(selected) : 'out';
  const alternatives = useMemo(
    () => availability.filter((a) => a.branch.id !== branchId && levelAt(a) !== 'out').sort((a, b) => Number(b.branch.state === selected?.branch.state) - Number(a.branch.state === selected?.branch.state)),
    [availability, branchId, key, selected?.branch.state],
  );
  const cartHasOtherBranch = Boolean(cart?.branch && cart.lines.length > 0 && cart.branch.id !== branchId);

  const enquiry = whatsappLink(
    selected?.branch.whatsapp ?? availability[0]?.branch.whatsapp ?? '',
    `Hello ${companyName}, I am interested in ${product.name}${variant ? ` (${variant.label})` : ''}, Product SKU: ${variant?.sku ?? product.sku}. Please confirm its availability and price at your ${selected?.branch.name ?? ''} branch.`,
  );

  const add = async () => {
    if (product.hasVariants && !variantId) return toast.error('Choose an option first.');
    try {
      if (branchId && cart?.branch?.id !== branchId && !(cart?.lines.length)) await setBranch(branchId);
      const existing = cart?.lines.find((l) => l.product.id === product.id && (l.variant?.id ?? null) === (variantId || null));
      await setItem(product.id, variantId || null, Math.min(100, (existing?.quantity ?? 0) + qty));
      setAdded(true);
      setTimeout(() => setAdded(false), 2500);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="mt-5 space-y-6">
      <Price price={price.price} discountPrice={price.discountPrice} size="lg" />

      {product.hasVariants && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Choose an option</legend>
          <div className="flex flex-wrap gap-2">
            {product.variants.map((v) => {
              const anywhere = availability.some((a) => (a.levels[v.id] ?? 'out') !== 'out');
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={variantId === v.id}
                  onClick={() => setVariantId(v.id)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm font-medium',
                    variantId === v.id ? 'border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600' : 'border-line-strong bg-surface hover:border-ink-faint',
                    !anywhere && 'text-ink-faint line-through decoration-1',
                  )}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Pick up or order from</legend>
        <ul className="space-y-2">
          {availability.map((a) => {
            const l = LEVEL_TEXT[levelAt(a)];
            return (
              <li key={a.branch.id}>
                <label className={cn('flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5', a.branch.id === branchId ? 'border-brand-600 bg-brand-50/50' : 'border-line hover:border-line-strong')}>
                  <input type="radio" name="branch" className="accent-brand-700" checked={a.branch.id === branchId} onChange={() => setBranchId(a.branch.id)} />
                  <span className="flex-1">
                    <span className="block text-sm font-medium">{a.branch.name}</span>
                    <span className="flex items-center gap-1 text-xs text-ink-muted"><MapPin className="h-3 w-3" aria-hidden /> {a.branch.city}</span>
                  </span>
                  <span className={cn('text-sm font-semibold', l.cls)}>{product.hasVariants && !variantId ? (a.level === 'out' ? 'Out of stock' : 'Available') : l.label}</span>
                </label>
              </li>
            );
          })}
        </ul>
        {selected && selectedLevel === 'out' && (!product.hasVariants || variantId) && (
          <Alert kind="info" className="mt-3" title={`Not available at ${selected.branch.name}`}>
            {alternatives.length ? (
              <>
                Available at{' '}
                {alternatives.slice(0, 3).map((a, i) => (
                  <span key={a.branch.id}>
                    {i > 0 && ', '}
                    <button type="button" className="font-semibold underline" onClick={() => setBranchId(a.branch.id)}>{a.branch.name}</button>
                  </span>
                ))}
                .
              </>
            ) : (
              'No branch has it right now. Send us a WhatsApp message and we will tell you when it is back.'
            )}
          </Alert>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-lg border border-line-strong" role="group" aria-label="Quantity">
          <button type="button" className="flex h-11 w-11 items-center justify-center text-ink-muted hover:text-ink" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Fewer"><Minus className="h-4 w-4" /></button>
          <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">{qty}</span>
          <button type="button" className="flex h-11 w-11 items-center justify-center text-ink-muted hover:text-ink" onClick={() => setQty(Math.min(20, qty + 1))} aria-label="More"><Plus className="h-4 w-4" /></button>
        </div>
        <Button size="lg" className="flex-1" onClick={add} loading={busy} disabled={selectedLevel === 'out' || (product.hasVariants && !variantId) || cartHasOtherBranch}>
          {added ? <><Check className="h-5 w-5" /> Added</> : <><ShoppingBag className="h-5 w-5" /> Add to cart</>}
        </Button>
      </div>
      {cartHasOtherBranch && (
        <p className="text-sm text-ink-muted">
          Your cart is for <strong>{cart!.branch!.name}</strong>. Choose that branch above, or <Link href="/cart" className="font-semibold text-brand-700 underline">change the cart branch</Link>. Each order comes from one branch.
        </p>
      )}
      {added && <Link href="/cart" className={buttonClasses('secondary', 'md', 'w-full')}>View cart and check out</Link>}

      {selectedLevel !== 'out' && (!product.hasVariants || variantId) && (
        <Button variant="secondary" className="w-full" onClick={() => setReserving(true)}>
          <CalendarClock className="h-4 w-4" /> Reserve at {selected?.branch.name ?? 'this branch'} and pay when you collect
        </Button>
      )}
      {reserving && selected && (
        <ReserveDialog product={product} variantId={variantId || null} quantity={qty} branch={selected.branch} onClose={() => setReserving(false)} />
      )}

      <WhatsAppLink context="product" refId={product.slug} branch={selected?.branch.id} href={enquiry} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 text-sm hover:border-brand-300">
        <MessageCircle className="h-6 w-6 shrink-0 text-brand-600" aria-hidden />
        <span><span className="block font-semibold">Ask about this product on WhatsApp</span><span className="text-ink-muted">Message {selected?.branch.name ?? 'the branch'} directly. We usually reply within the hour during opening times.</span></span>
      </WhatsAppLink>
    </div>
  );
}
