import type { BranchAvailabilityDto, PublicProductDto, PublicSettingsDto } from '@mb/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProductGrid } from '@/components/store/product-card';
import { serverGet } from '@/lib/server-api';
import { imageUrl } from '@/lib/utils';
import { Gallery } from './gallery';
import { Purchase } from './purchase';

export const revalidate = 120;
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

const getProduct = (slug: string) => serverGet<PublicProductDto>(`/products/${encodeURIComponent(slug)}`, 120);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await getProduct((await params).slug);
  if (!p) return { title: 'Product not found' };
  const description = (p.description || `${p.name} at Mudassir & Brothers, Kano and Abuja.`).slice(0, 160);
  return {
    title: p.name,
    description,
    alternates: { canonical: `/products/${p.slug}` },
    openGraph: { title: p.name, description, images: p.images.slice(0, 1).map((i) => imageUrl(i.url, 1200)!) },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();
  const [availability, related, settings] = await Promise.all([
    serverGet<BranchAvailabilityDto[]>(`/products/${slug}/availability`, 60),
    serverGet<PublicProductDto[]>(`/products/${slug}/related`, 300),
    serverGet<PublicSettingsDto>('/settings'),
  ]);
  const inStockSomewhere = (availability ?? []).some((a) => a.level !== 'out');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    sku: product.sku,
    description: product.description || undefined,
    image: product.images.map((i) => i.url),
    brand: product.brand ? { '@type': 'Brand', name: product.brand.name } : undefined,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'NGN',
      price: ((product.discountPrice ?? product.price) / 100).toFixed(2),
      availability: inStockSomewhere ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `${SITE}/products/${product.slug}`,
      seller: { '@type': 'Organization', name: settings?.companyName ?? 'Mudassir & Brothers' },
    },
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ink-muted">
        <Link href="/shop" className="hover:text-ink">Shop</Link>
        {product.category && <> / <Link href={`/categories/${product.category.slug}`} className="hover:text-ink">{product.category.name}</Link></>}
      </nav>
      <div className="grid gap-8 lg:grid-cols-2">
        <Gallery images={product.images} name={product.name} />
        <div>
          {product.brand && <p className="text-sm font-semibold tracking-wide text-accent-600 uppercase">{product.brand.name}</p>}
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{product.name}</h1>
          <p className="mt-1 text-sm text-ink-faint">SKU {product.sku}</p>
          <Purchase product={product} availability={availability ?? []} companyName={settings?.companyName ?? 'Mudassir & Brothers'} />
        </div>
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        {product.description && (
          <section aria-labelledby="desc">
            <h2 id="desc" className="text-xl font-bold">Description</h2>
            <p className="mt-3 leading-relaxed whitespace-pre-line text-ink-muted">{product.description}</p>
          </section>
        )}
        {product.specifications.length > 0 && (
          <section aria-labelledby="specs">
            <h2 id="specs" className="text-xl font-bold">Specifications</h2>
            <table className="mt-3 w-full text-sm">
              <tbody className="divide-y divide-line">
                {product.specifications.map((s, i) => (
                  <tr key={i}><th scope="row" className="w-2/5 py-2 pr-4 text-left font-medium text-ink-muted">{s.label}</th><td className="py-2">{s.value}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {related && related.length > 0 && (
        <section className="mt-14" aria-labelledby="related">
          <h2 id="related" className="mb-4 text-xl font-bold">You may also like</h2>
          <ProductGrid products={related.slice(0, 4)} />
        </section>
      )}
    </div>
  );
}
