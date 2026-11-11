import type { Metadata } from 'next';
import { type ShopParams, ShopView } from '@/components/store/shop-view';

export async function generateMetadata({ searchParams }: { searchParams: Promise<ShopParams> }): Promise<Metadata> {
  const p = await searchParams;
  return p.q
    ? { title: `Search: ${p.q}`, robots: { index: false, follow: true } }
    : { title: 'Shop', description: 'Electronics, home appliances and more from Mudassir & Brothers, with stock at our Kano and Abuja branches.', alternates: { canonical: '/shop' } };
}

export default async function ShopPage({ searchParams }: { searchParams: Promise<ShopParams> }) {
  const params = await searchParams;
  return <ShopView params={params} basePath="/shop" heading={params.q ? `Results for “${params.q}”` : 'Shop'} />;
}
