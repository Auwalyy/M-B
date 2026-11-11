import type { CategoryDto, PublicProductDto } from '@mb/shared';
import type { MetadataRoute } from 'next';
import { serverGet, serverPage } from '@/lib/server-api';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
export const revalidate = 3600;

async function allProducts(): Promise<PublicProductDto[]> {
  const out: PublicProductDto[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await serverPage<PublicProductDto>(`/products?limit=100&page=${page}`, 3600);
    if (!res) break;
    out.push(...res.data);
    if (page >= res.meta.pages) break;
  }
  return out;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories] = await Promise.all([allProducts(), serverGet<CategoryDto[]>('/categories', 3600)]);
  return [
    { url: `${SITE}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE}/shop`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE}/branches`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE}/about`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE}/contact`, changeFrequency: 'monthly', priority: 0.4 },
    ...(categories ?? []).map((c) => ({ url: `${SITE}/categories/${c.slug}`, changeFrequency: 'weekly' as const, priority: 0.8 })),
    ...products.map((p) => ({ url: `${SITE}/products/${p.slug}`, changeFrequency: 'weekly' as const, priority: 0.7 })),
  ];
}
