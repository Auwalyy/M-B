import type { BrandDto, CategoryDto, PublicBranchDto, PublicProductDto } from '@mb/shared';
import { ChevronLeft, ChevronRight, SearchX } from 'lucide-react';
import Link from 'next/link';
import { buttonClasses } from '@/components/ui/button';
import { Alert, EmptyState } from '@/components/ui/display';
import { serverGet, serverPage } from '@/lib/server-api';
import { ProductGrid } from './product-card';
import { AutoSubmit } from './auto-submit';

export type ShopParams = {
  q?: string;
  category?: string;
  brand?: string;
  min?: string;
  max?: string;
  branch?: string;
  sort?: string;
  page?: string;
};

const SORTS = [
  ['newest', 'Newest'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['name', 'Name A–Z'],
] as const;

const toKobo = (naira?: string) => (naira && /^\d+$/.test(naira) ? String(Number(naira) * 100) : undefined);

/** Tree order with depth for the category filter. */
function flatten(categories: CategoryDto[]) {
  const out: { c: CategoryDto; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const c of categories.filter((x) => x.parent === parent).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
      out.push({ c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * Product listing used by /shop, /search and category pages. Filters are a plain GET form,
 * so they work without JavaScript and every filtered view has its own shareable, indexable URL.
 */
export async function ShopView({ params, basePath, fixedCategory, heading, intro }: { params: ShopParams; basePath: string; fixedCategory?: CategoryDto; heading: string; intro?: string }) {
  const page = Math.max(1, Number(params.page) || 1);
  const category = fixedCategory?.id ?? params.category;
  const qs = new URLSearchParams(
    Object.entries({
      q: params.q,
      category,
      brand: params.brand,
      minPrice: toKobo(params.min),
      maxPrice: toKobo(params.max),
      branch: params.branch,
      inStock: params.branch ? 'true' : undefined,
      sort: params.sort,
      page: String(page),
      limit: '24',
    }).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const [result, categories, brands, branches] = await Promise.all([
    serverPage<PublicProductDto>(`/products?${qs}`),
    serverGet<CategoryDto[]>('/categories'),
    serverGet<BrandDto[]>('/brands'),
    serverGet<PublicBranchDto[]>('/branches'),
  ]);
  const cats = flatten(categories ?? []);
  const link = (p: number) => {
    const next = new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter((e): e is [string, string] => Boolean(e[1])));
    return `${basePath}?${next}`;
  };
  const filtered = Boolean(params.q || params.brand || params.min || params.max || params.branch || (!fixedCategory && params.category));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
      {intro && <p className="mt-2 max-w-2xl text-ink-muted">{intro}</p>}
      {fixedCategory && cats.some((x) => x.c.parent === fixedCategory.id) && (
        <nav aria-label="Subcategories" className="mt-4 flex flex-wrap gap-2">
          {cats.filter((x) => x.c.parent === fixedCategory.id).map(({ c }) => (
            <Link key={c.id} href={`/categories/${c.slug}`} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-brand-400">{c.name}</Link>
          ))}
        </nav>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[15rem_1fr]">
        <form method="get" action={basePath} className="space-y-5 self-start rounded-xl border border-line bg-surface p-4 lg:sticky lg:top-24" aria-label="Filter products">
          {params.q && <input type="hidden" name="q" value={params.q} />}
          {!fixedCategory && (
            <label className="block text-sm font-medium">
              Category
              <select name="category" defaultValue={params.category ?? ''} className="mt-1 block h-10 w-full rounded-lg border border-line-strong bg-surface px-2 text-sm">
                <option value="">All categories</option>
                {cats.map(({ c, depth }) => <option key={c.id} value={c.id}>{'  '.repeat(depth)}{c.name}</option>)}
              </select>
            </label>
          )}
          <label className="block text-sm font-medium">
            Brand
            <select name="brand" defaultValue={params.brand ?? ''} className="mt-1 block h-10 w-full rounded-lg border border-line-strong bg-surface px-2 text-sm">
              <option value="">All brands</option>
              {(brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <fieldset>
            <legend className="text-sm font-medium">Price (₦)</legend>
            <div className="mt-1 flex items-center gap-2">
              <input name="min" inputMode="numeric" pattern="\d*" placeholder="Min" defaultValue={params.min} aria-label="Minimum price in naira" className="h-10 w-full rounded-lg border border-line-strong px-2 text-sm" />
              <span className="text-ink-faint">–</span>
              <input name="max" inputMode="numeric" pattern="\d*" placeholder="Max" defaultValue={params.max} aria-label="Maximum price in naira" className="h-10 w-full rounded-lg border border-line-strong px-2 text-sm" />
            </div>
          </fieldset>
          <label className="block text-sm font-medium">
            In stock at
            <select name="branch" defaultValue={params.branch ?? ''} className="mt-1 block h-10 w-full rounded-lg border border-line-strong bg-surface px-2 text-sm">
              <option value="">Any branch</option>
              {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <input type="hidden" name="sort" value={params.sort ?? ''} />
          <div className="flex gap-2">
            <button type="submit" className={buttonClasses('primary', 'sm', 'flex-1')}>Apply</button>
            {filtered && <Link href={params.q ? `${basePath}?q=${encodeURIComponent(params.q)}` : basePath} className={buttonClasses('ghost', 'sm')}>Clear</Link>}
          </div>
        </form>

        <section aria-label="Products">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted" aria-live="polite">
              {result ? `${result.meta.total} product${result.meta.total === 1 ? '' : 's'}` : ''}{params.q ? ` for “${params.q}”` : ''}
            </p>
            <AutoSubmit action={basePath} params={params} name="sort" value={params.sort ?? 'newest'} options={SORTS} label="Sort by" />
          </div>
          {!result ? (
            <Alert kind="warning" title="Products are temporarily unavailable">Please try again in a moment.</Alert>
          ) : result.data.length === 0 ? (
            <EmptyState icon={SearchX} title="No products found" description={filtered ? 'Try removing a filter or searching for something else.' : 'New products are on the way.'} action={filtered ? <Link href={basePath} className={buttonClasses('secondary')}>Clear filters</Link> : undefined} />
          ) : (
            <>
              <ProductGrid products={result.data} eager={4} />
              {result.meta.pages > 1 && (
                <nav aria-label="Pages" className="mt-8 flex items-center justify-center gap-2">
                  {page > 1 && <Link href={link(page - 1)} className={buttonClasses('secondary', 'sm')} rel="prev"><ChevronLeft className="h-4 w-4" /> Previous</Link>}
                  <span className="px-3 text-sm text-ink-muted">Page {page} of {result.meta.pages}</span>
                  {page < result.meta.pages && <Link href={link(page + 1)} className={buttonClasses('secondary', 'sm')} rel="next">Next <ChevronRight className="h-4 w-4" /></Link>}
                </nav>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
