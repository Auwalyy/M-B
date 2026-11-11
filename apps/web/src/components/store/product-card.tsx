import { type PublicProductDto, formatNaira } from '@mb/shared';
import { Package } from 'lucide-react';
import Link from 'next/link';
import { imageUrl } from '@/lib/utils';

export function Price({ price, discountPrice, size = 'md' }: { price: number; discountPrice: number | null; size?: 'md' | 'lg' }) {
  const sale = discountPrice != null && discountPrice < price;
  const pct = sale ? Math.round(((price - discountPrice!) / price) * 100) : 0;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className={size === 'lg' ? 'text-3xl font-extrabold tracking-tight' : 'text-base font-bold'}>{formatNaira(sale ? discountPrice! : price)}</span>
      {sale && (
        <>
          <span className="text-sm text-ink-faint line-through">{formatNaira(price)}</span>
          <span className="rounded bg-accent-50 px-1.5 py-0.5 text-xs font-bold text-accent-700">−{pct}%</span>
        </>
      )}
    </span>
  );
}

export function ProductCard({ p, priority }: { p: PublicProductDto; priority?: boolean }) {
  const img = imageUrl(p.images[0]?.url, 480);
  return (
    <Link href={`/products/${p.slug}`} className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition-shadow hover:shadow-pop focus-visible:shadow-pop">
      <div className="relative aspect-square bg-subtle">
        {img ? (
          <img src={img} alt={p.images[0]?.alt ?? p.name} loading={priority ? 'eager' : 'lazy'} className="h-full w-full object-contain p-3 transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <span className="flex h-full items-center justify-center text-ink-faint"><Package className="h-10 w-10" aria-hidden /></span>
        )}
        {p.isFeatured && <span className="absolute top-2 left-2 rounded-full bg-brand-700 px-2 py-0.5 text-[11px] font-semibold text-white">Featured</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        {p.brand && <span className="text-xs font-semibold tracking-wide text-ink-faint uppercase">{p.brand.name}</span>}
        <h3 className="line-clamp-2 text-sm font-semibold text-ink group-hover:text-brand-700">{p.name}</h3>
        <div className="mt-auto pt-1"><Price price={p.price} discountPrice={p.discountPrice} /></div>
        {p.hasVariants && <span className="text-xs text-ink-muted">{p.variants.length} options</span>}
      </div>
    </Link>
  );
}

export function ProductGrid({ products, eager = 0 }: { products: PublicProductDto[]; eager?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {products.map((p, i) => <ProductCard key={p.id} p={p} priority={i < eager} />)}
    </div>
  );
}
