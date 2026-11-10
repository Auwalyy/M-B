'use client';

import { PERMISSIONS, type ProductDto } from '@mb/shared';
import { Package, Plus, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useMemo, useState } from 'react';
import { Money, Thumb } from '@/components/admin/commerce';
import { categoryOptions } from '@/components/admin/product-form';
import { ButtonLink } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Card, PageHeader } from '@/components/ui/display';
import { Input, Select } from '@/components/ui/field';
import { errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useBrands, useCategories, useProducts } from '@/lib/queries';

const STATUS_TONE = { active: 'success', draft: 'warning', inactive: 'neutral' } as const;

export default function ProductsPage() {
  const router = useRouter();
  const canWrite = useCan(PERMISSIONS.PRODUCTS_WRITE);
  const canStock = useCan(PERMISSIONS.INVENTORY_READ);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const search = useDeferredValue(q);
  const products = useProducts({ q: search, category, brand, status, page, limit: 25 });
  const categories = useCategories();
  const brands = useBrands();
  const cats = useMemo(() => categoryOptions(categories.data), [categories.data]);
  const reset = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); };
  const filtered = Boolean(q || category || brand || status);

  return (
    <>
      <PageHeader
        title="Products"
        description={canWrite ? 'The company catalogue. Stock is managed per branch under Inventory.' : 'The company catalogue with stock at your branches.'}
        actions={canWrite && <ButtonLink href="/admin/catalog/products/new"><Plus className="h-4 w-4" /> Add product</ButtonLink>}
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Search name, SKU or barcode" className="pl-9" aria-label="Search products" />
          </div>
          <Select value={category} onChange={(e) => reset(setCategory)(e.target.value)} className="w-48" aria-label="Category">
            <option value="">All categories</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
          <Select value={brand} onChange={(e) => reset(setBrand)(e.target.value)} className="w-40" aria-label="Brand">
            <option value="">All brands</option>
            {brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className="w-36" aria-label="Status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>
        <DataTable<ProductDto>
          caption="Products"
          rows={products.data?.data}
          rowKey={(p) => p.id}
          loading={products.isLoading}
          error={products.error ? errorMessage(products.error) : null}
          onRetry={() => products.refetch()}
          onRowClick={(p) => router.push(`/admin/catalog/products/${p.id}`)}
          meta={products.data?.meta}
          onPageChange={setPage}
          empty={{
            icon: Package,
            title: filtered ? 'No products match your filters' : 'No products yet',
            description: canWrite && !filtered ? 'Add categories first, then your first product.' : undefined,
            action: canWrite && !filtered ? <ButtonLink href="/admin/catalog/products/new"><Plus className="h-4 w-4" /> Add product</ButtonLink> : undefined,
          }}
          columns={[
            {
              header: 'Product',
              cell: (p) => (
                <div className="flex items-center gap-3">
                  <Thumb url={p.images[0]?.url} alt="" />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{p.name}{p.isFeatured && <Badge tone="accent" className="ml-2">Featured</Badge>}</p>
                    <p className="text-xs text-ink-muted">{p.sku}{p.hasVariants ? ` · ${p.variants.length} variants` : ''}</p>
                  </div>
                </div>
              ),
            },
            { header: 'Category', hideOnMobile: true, cell: (p) => <span className="text-ink-muted">{p.category?.name ?? '—'}{p.brand ? ` · ${p.brand.name}` : ''}</span> },
            {
              header: 'Price',
              cell: (p) =>
                p.discountPrice != null ? (
                  <span><Money kobo={p.discountPrice} className="font-semibold" /> <Money kobo={p.price} className="text-xs text-ink-faint line-through" /></span>
                ) : (
                  <Money kobo={p.price} className="font-semibold" />
                ),
            },
            ...(canStock
              ? [{ header: 'Available', hideOnMobile: true, cell: (p: ProductDto) => <span className={p.stock && p.stock.available <= 0 ? 'text-danger-700' : 'tabular-nums'}>{p.stock?.available ?? 0}</span> }]
              : []),
            { header: 'Status', cell: (p) => <Badge tone={STATUS_TONE[p.status]} dot>{p.status[0]!.toUpperCase() + p.status.slice(1)}</Badge> },
          ]}
        />
      </Card>
    </>
  );
}
