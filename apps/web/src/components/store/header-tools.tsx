'use client';

import { Search, ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useCart } from '@/lib/cart';

function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  return (
    <form
      role="search"
      action="/shop"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(q.trim() ? `/shop?q=${encodeURIComponent(q.trim())}` : '/shop');
      }}
      className="relative w-full"
    >
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
      <input
        name="q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        type="search"
        placeholder="Search TVs, fridges, fans…"
        aria-label="Search products"
        className="h-10 w-full rounded-full border border-line-strong bg-subtle pr-4 pl-9 text-sm focus:border-brand-500 focus:bg-surface focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
      />
    </form>
  );
}

export function HeaderSearch() {
  return (
    <Suspense fallback={<div className="h-10 w-full rounded-full bg-subtle" />}>
      <SearchBox />
    </Suspense>
  );
}

export function CartButton() {
  const { cart } = useCart();
  const count = cart?.itemCount ?? 0;
  return (
    <Link href="/cart" className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-black/5 hover:text-ink" aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}>
      <ShoppingBag className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-600 px-1 text-[11px] font-bold text-white" aria-hidden>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
