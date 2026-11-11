import { redirect } from 'next/navigation';

/** /search?q=… is an alias for the shop with a search term. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  redirect(q ? `/shop?q=${encodeURIComponent(q)}` : '/shop');
}
