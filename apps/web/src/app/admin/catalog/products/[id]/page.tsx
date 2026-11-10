'use client';

import { type ImageDto, type InventoryDto, PERMISSIONS, type ProductDto } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, Boxes, Star, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useState } from 'react';
import { ImageDrop, LevelBadge, Money, Tabs } from '@/components/admin/commerce';
import { ProductForm } from '@/components/admin/product-form';
import { Button, ButtonLink } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, Skeleton } from '@/components/ui/display';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { keys2, useInventory, useProduct } from '@/lib/queries';
import { imageUrl } from '@/lib/utils';

function Photos({ product, canWrite, onChange }: { product: ProductDto; canWrite: boolean; onChange: (p: ProductDto) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [alts, setAlts] = useState<Record<string, string>>({});

  const saveOrder = async (images: ImageDto[]) => {
    try {
      onChange(await api.put<ProductDto>(`/products/${product.id}/images`, { images: images.map((i) => ({ id: i.id, alt: alts[i.id] ?? i.alt ?? undefined })) }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const move = (from: number, to: number) => {
    const next = [...product.images];
    const [img] = next.splice(from, 1);
    next.splice(to, 0, img!);
    void saveOrder(next);
  };

  return (
    <div className="space-y-6">
      {canWrite && product.images.length < 12 && (
        <ImageDrop
          multiple
          busy={busy}
          label="Choose photos"
          onFiles={async (files) => {
            setBusy(true);
            try {
              onChange(await api.upload<ProductDto>(`/products/${product.id}/images`, 'images', files.slice(0, 12 - product.images.length)));
              toast.success(`${files.length} photo${files.length === 1 ? '' : 's'} added`);
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {product.images.length === 0 ? (
        <Alert kind="warning">This product has no photos. Products with photos sell much better online.</Alert>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {product.images.map((img, i) => (
            <li key={img.id} className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="relative aspect-square bg-subtle">
                <img src={imageUrl(img.url, 480)!} alt={img.alt ?? product.name} className="h-full w-full object-contain" loading="lazy" />
                {i === 0 && <Badge tone="accent" className="absolute top-2 left-2"><Star className="h-3 w-3" /> Main photo</Badge>}
              </div>
              {canWrite && (
                <div className="space-y-2 p-3">
                  <Input
                    aria-label="Description for screen readers"
                    placeholder="Describe the photo"
                    defaultValue={img.alt ?? ''}
                    onChange={(e) => setAlts((a) => ({ ...a, [img.id]: e.target.value }))}
                    onBlur={() => alts[img.id] !== undefined && alts[img.id] !== img.alt && void saveOrder(product.images)}
                  />
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Move later" disabled={i === product.images.length - 1} onClick={() => move(i, i + 1)}><ArrowDown className="h-4 w-4" /></Button>
                    {i !== 0 && <Button size="sm" variant="ghost" onClick={() => move(i, 0)}>Make main</Button>}
                    <ConfirmDialog
                      title="Delete this photo?"
                      description="It is removed from the website and from image storage."
                      confirmLabel="Delete photo"
                      onConfirm={async () => {
                        try {
                          onChange(await api.delete<ProductDto>(`/products/${product.id}/images/${img.id}`));
                        } catch (err) {
                          toast.error(errorMessage(err));
                          throw err;
                        }
                      }}
                      trigger={(o) => <Button size="icon" variant="ghost" className="ml-auto" aria-label="Delete photo" onClick={o}><Trash2 className="h-4 w-4" /></Button>}
                    />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StockByBranch({ product }: { product: ProductDto }) {
  const inv = useInventory({ product: product.id, limit: 100 });
  const canReceive = useCan(PERMISSIONS.INVENTORY_STOCK_IN);
  return (
    <Card>
      <CardHeader
        title="Stock by branch"
        description="Your branches only. Change quantities from Inventory."
        actions={canReceive && <ButtonLink href={`/admin/inventory?product=${product.id}`} size="sm" variant="secondary"><Boxes className="h-4 w-4" /> Manage stock</ButtonLink>}
      />
      <DataTable<InventoryDto>
        caption="Stock by branch"
        rows={inv.data?.data}
        rowKey={(r) => r.id}
        loading={inv.isLoading}
        error={inv.error ? errorMessage(inv.error) : null}
        empty={{ icon: Boxes, title: 'No stock recorded yet', description: 'Receive stock at a branch to start tracking it.' }}
        columns={[
          { header: 'Branch', cell: (r) => <span className="font-medium">{r.branch.code} · {r.branch.name}</span> },
          ...(product.hasVariants ? [{ header: 'Variant', cell: (r: InventoryDto) => r.variant?.label ?? '—' }] : []),
          { header: 'On hand', cell: (r) => <span className="tabular-nums">{r.quantity}</span> },
          { header: 'Reserved', hideOnMobile: true, cell: (r) => <span className="tabular-nums text-ink-muted">{r.reserved}</span> },
          { header: 'Available', cell: (r) => <span className="font-semibold tabular-nums">{r.available}</span> },
          { header: 'Level', cell: (r) => <LevelBadge level={r.level} /> },
        ]}
      />
    </Card>
  );
}

function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = useCan(PERMISSIONS.PRODUCTS_WRITE);
  const showCost = useCan(PERMISSIONS.INVENTORY_READ_COST);
  const canStock = useCan(PERMISSIONS.INVENTORY_READ);
  const product = useProduct(id);
  const [tab, setTab] = useState<'details' | 'photos' | 'stock'>((params.get('tab') as 'photos') ?? 'details');

  const back = <Link href="/admin/catalog/products" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Products</Link>;
  if (product.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-96" /></div>;
  if (product.error || !product.data) return <><PageHeader title="Product" back={back} /><Alert>{product.error ? errorMessage(product.error) : 'Not found'}</Alert></>;
  const p = product.data;
  const update = (np: ProductDto) => {
    qc.setQueryData(keys2.product(id), np);
    void qc.invalidateQueries({ queryKey: ['products'] });
  };

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={p.name}
        back={back}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono">{p.sku}</span>
            <Badge tone={p.status === 'active' ? 'success' : p.status === 'draft' ? 'warning' : 'neutral'} dot>{p.status}</Badge>
            <Money kobo={p.discountPrice ?? p.price} className="font-semibold text-ink" />
            {p.stock && <span>· {p.stock.available} available in your branches</span>}
          </span>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'photos', label: 'Photos', badge: <Badge>{p.images.length}</Badge> },
          ...(canStock ? [{ id: 'stock' as const, label: 'Stock by branch' }] : []),
        ]}
      />
      {tab === 'details' &&
        (canWrite ? (
          <ProductForm
            key={p.updatedAt}
            product={p}
            showCost={showCost}
            submitLabel="Save changes"
            onSubmit={async (payload) => {
              update(await api.patch<ProductDto>(`/products/${id}`, payload));
              toast.success('Product saved');
            }}
          />
        ) : (
          <Card>
            <CardBody className="space-y-3 text-sm">
              <p className="whitespace-pre-line">{p.description || 'No description.'}</p>
              {p.specifications.length > 0 && (
                <dl className="grid grid-cols-[10rem_1fr] gap-y-1">
                  {p.specifications.map((s, i) => (
                    <Fragment key={i}><dt className="text-ink-muted">{s.label}</dt><dd>{s.value}</dd></Fragment>
                  ))}
                </dl>
              )}
              {p.hasVariants && <p><span className="text-ink-muted">Variants:</span> {p.variants.map((v) => `${v.label} (${v.sku})`).join(', ')}</p>}
            </CardBody>
          </Card>
        ))}
      {tab === 'photos' && <Photos product={p} canWrite={canWrite} onChange={update} />}
      {tab === 'stock' && <StockByBranch product={p} />}
    </div>
  );
}

export default function ProductDetailPage() {
  return (
    <Suspense>
      <ProductDetail />
    </Suspense>
  );
}
