import type { CategoryDto } from '@mb/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { type ShopParams, ShopView } from '@/components/store/shop-view';
import { serverGet } from '@/lib/server-api';

async function findCategory(slug: string) {
  const all = (await serverGet<CategoryDto[]>('/categories')) ?? [];
  const category = all.find((c) => c.slug === slug);
  return { category, trail: category ? category.ancestors.map((id) => all.find((c) => c.id === id)).filter((c): c is CategoryDto => Boolean(c)) : [] };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { category } = await findCategory((await params).slug);
  if (!category) return { title: 'Category not found' };
  return {
    title: category.name,
    description: category.description ?? `Shop ${category.name} at Mudassir & Brothers in Kano and Abuja.`,
    alternates: { canonical: `/categories/${category.slug}` },
    openGraph: category.image ? { images: [category.image.url] } : undefined,
  };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<ShopParams> }) {
  const { category, trail } = await findCategory((await params).slug);
  if (!category) notFound();
  return (
    <>
      <nav aria-label="Breadcrumb" className="mx-auto max-w-6xl px-4 pt-6 text-sm text-ink-muted">
        <ol className="flex flex-wrap gap-1">
          <li><Link href="/shop" className="hover:text-ink">Shop</Link></li>
          {trail.map((c) => <li key={c.id}>/ <Link href={`/categories/${c.slug}`} className="hover:text-ink">{c.name}</Link></li>)}
          <li aria-current="page">/ <span className="text-ink">{category.name}</span></li>
        </ol>
      </nav>
      <ShopView params={await searchParams} basePath={`/categories/${category.slug}`} fixedCategory={category} heading={category.name} intro={category.description ?? undefined} />
    </>
  );
}
