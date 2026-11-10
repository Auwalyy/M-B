'use client';

import { type InventoryDto, type ProductDto, type StockLevel, type VariantDto, formatNaira } from '@mb/shared';
import { ImageIcon, Minus, Package, Plus, Search, Trash2, Upload } from 'lucide-react';
import { type InputHTMLAttributes, type ReactNode, forwardRef, useDeferredValue, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Skeleton } from '@/components/ui/display';
import { Input, Select } from '@/components/ui/field';
import { useAllBranches, useBranches, useInventory, useProducts } from '@/lib/queries';
import { cn, imageUrl } from '@/lib/utils';

// ------------------------------------------------------------------ money

export function Money({ kobo, className }: { kobo: number | null | undefined; className?: string }) {
  if (kobo === null || kobo === undefined) return <span className={className}>—</span>;
  return <span className={cn('tabular-nums', className)}>{formatNaira(kobo)}</span>;
}

/** Text input for naira amounts; the parent converts with parseNaira(). */
export const NairaInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function NairaInput({ className, ...props }, ref) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-muted">₦</span>
      <Input ref={ref} inputMode="decimal" className={cn('pl-7 tabular-nums', className)} {...props} />
    </div>
  );
});

// ------------------------------------------------------------------ stock

const LEVEL: Record<StockLevel, { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  in_stock: { tone: 'success', label: 'In stock' },
  low: { tone: 'warning', label: 'Low' },
  out: { tone: 'danger', label: 'Out' },
};

export function LevelBadge({ level }: { level: StockLevel }) {
  const l = LEVEL[level];
  return <Badge tone={l.tone} dot>{l.label}</Badge>;
}

export function Thumb({ url, alt, size = 40 }: { url: string | null | undefined; alt: string; size?: number }) {
  const src = imageUrl(url, size * 2);
  return src ? (
    <img src={src} alt={alt} width={size} height={size} loading="lazy" className="shrink-0 rounded-md border border-line bg-subtle object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-md border border-line bg-subtle text-ink-faint" style={{ width: size, height: size }} aria-hidden>
      <Package className="h-4 w-4" />
    </span>
  );
}

// ------------------------------------------------------------------ branches

/** Branches the signed-in user can see. With one branch, the choice is shown but fixed. */
export function BranchSelect({
  value,
  onChange,
  allowAll,
  label = 'Branch',
  only,
  className,
  everyBranch,
}: {
  value: string;
  onChange: (id: string) => void;
  allowAll?: boolean;
  label?: string;
  /** Restrict choices (e.g. branches where the user may receive stock). */
  only?: (id: string) => boolean;
  className?: string;
  /** List every active branch, not only the user's own. */
  everyBranch?: boolean;
}) {
  const mine = useBranches({ status: 'active' });
  const every = useAllBranches();
  const branches = everyBranch ? { isLoading: every.isLoading, list: every.data ?? [] } : { isLoading: mine.isLoading, list: mine.data?.data ?? [] };
  const list = branches.list.filter((b) => !only || only(b.id));
  if (branches.isLoading) return <Skeleton className={cn('h-10 w-48', className)} />;
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={cn('w-52', className)} disabled={!allowAll && list.length === 1}>
      {allowAll && <option value="">All branches</option>}
      {!allowAll && !value && <option value="">Choose a branch</option>}
      {list.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
    </Select>
  );
}

// ------------------------------------------------------------------ product search

export interface PickedItem {
  product: ProductDto;
  variant: VariantDto | null;
}

/** Search box that returns a product (and variant, for variant products). */
export function ProductPicker({ onPick, placeholder = 'Search products by name or SKU', exclude }: { onPick: (item: PickedItem) => void; placeholder?: string; exclude?: (p: ProductDto, v: VariantDto | null) => boolean }) {
  const [q, setQ] = useState('');
  const [chooseVariant, setChooseVariant] = useState<ProductDto | null>(null);
  const search = useDeferredValue(q.trim());
  const results = useProducts({ q: search, limit: 8 }, search.length >= 2);
  const listId = useId();

  const pick = (product: ProductDto, variant: VariantDto | null) => {
    onPick({ product, variant });
    setQ('');
    setChooseVariant(null);
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
      <Input value={q} onChange={(e) => { setQ(e.target.value); setChooseVariant(null); }} placeholder={placeholder} className="pl-9" aria-label="Search products" aria-controls={listId} />
      {search.length >= 2 && (
        <div id={listId} className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop">
          {results.isFetching && !results.data && <div className="space-y-2 p-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>}
          {results.data?.data.length === 0 && <p className="px-3 py-2 text-sm text-ink-muted">No products match “{search}”.</p>}
          {chooseVariant ? (
            <div>
              <p className="px-3 py-1.5 text-xs font-semibold text-ink-muted">Choose a variant of {chooseVariant.name}</p>
              {chooseVariant.variants.map((v) => {
                const disabled = exclude?.(chooseVariant, v);
                return (
                  <button key={v.id} type="button" disabled={disabled} onClick={() => pick(chooseVariant, v)} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-subtle disabled:opacity-40">
                    <span>{v.label} <span className="text-ink-faint">· {v.sku}</span></span>
                    {v.status !== 'active' && <Badge>Inactive</Badge>}
                  </button>
                );
              })}
            </div>
          ) : (
            results.data?.data.map((p) => {
              const disabled = !p.hasVariants && exclude?.(p, null);
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => (p.hasVariants ? setChooseVariant(p) : pick(p, null))}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-subtle disabled:opacity-40"
                >
                  <Thumb url={p.images[0]?.url} alt="" size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                    <span className="block text-xs text-ink-muted">{p.sku}{p.hasVariants ? ` · ${p.variants.length} variants` : ''}</span>
                  </span>
                  {p.status !== 'active' && <Badge>{p.status}</Badge>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ line items (stock in/out, adjustments, transfers)

export interface Line extends PickedItem {
  key: string;
  quantity: number;
}

export const lineKey = (p: ProductDto, v: VariantDto | null) => `${p.id}:${v?.id ?? ''}`;

function AvailableAt({ branch, line }: { branch: string; line: Line }) {
  const inv = useInventory({ branch, product: line.product.id, limit: 100 }, Boolean(branch));
  if (!branch) return null;
  if (inv.isLoading) return <Skeleton className="h-4 w-16" />;
  const row = inv.data?.data.find((i: InventoryDto) => (i.variant?.id ?? null) === (line.variant?.id ?? null));
  return <span className="text-xs text-ink-muted">{row ? `${row.available} available` : 'None here'}</span>;
}

export function LineItems({
  lines,
  onChange,
  mode,
  branch,
  emptyHint,
}: {
  lines: Line[];
  onChange: (lines: Line[]) => void;
  /** quantity: positive amounts; delta: may be negative (count corrections). */
  mode: 'quantity' | 'delta';
  /** Show current availability at this branch. */
  branch?: string;
  emptyHint: ReactNode;
}) {
  const set = (key: string, quantity: number) => onChange(lines.map((l) => (l.key === key ? { ...l, quantity } : l)));
  return (
    <div className="space-y-3">
      <ProductPicker
        exclude={(p, v) => lines.some((l) => l.key === lineKey(p, v))}
        onPick={({ product, variant }) => onChange([...lines, { key: lineKey(product, variant), product, variant, quantity: mode === 'delta' ? -1 : 1 }])}
      />
      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-muted">{emptyHint}</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {lines.map((l) => (
            <li key={l.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <Thumb url={l.product.images[0]?.url} alt="" size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{l.product.name}{l.variant && <span className="text-ink-muted"> · {l.variant.label}</span>}</p>
                <div className="flex gap-2 text-xs text-ink-faint">
                  <span>{l.variant?.sku ?? l.product.sku}</span>
                  {branch && <AvailableAt branch={branch} line={l} />}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="secondary" aria-label="Decrease" onClick={() => set(l.key, l.quantity - 1 === 0 && mode === 'delta' ? -1 : Math.max(mode === 'delta' ? -100000 : 1, l.quantity - 1))}>
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  aria-label={`${mode === 'delta' ? 'Change' : 'Quantity'} for ${l.product.name}`}
                  className="h-9 w-20 text-center tabular-nums"
                  value={l.quantity}
                  onChange={(e) => set(l.key, Math.trunc(Number(e.target.value) || 0))}
                />
                <Button size="icon" variant="secondary" aria-label="Increase" onClick={() => set(l.key, l.quantity + 1 === 0 && mode === 'delta' ? 1 : l.quantity + 1)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <Button size="icon" variant="ghost" aria-label={`Remove ${l.product.name}`} onClick={() => onChange(lines.filter((x) => x.key !== l.key))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const toPayloadLines = (lines: Line[]) => lines.map((l) => ({ product: l.product.id, variantId: l.variant?.id ?? null, quantity: l.quantity }));

// ------------------------------------------------------------------ upload

export function ImageDrop({ onFiles, multiple, busy, label = 'Upload images' }: { onFiles: (files: File[]) => void; multiple?: boolean; busy?: boolean; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const accept = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    if (files.length) onFiles(files);
  };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); accept(e.dataTransfer.files); }}
      className={cn('flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors', over ? 'border-brand-500 bg-brand-50' : 'border-line-strong bg-subtle')}
    >
      <ImageIcon className="h-8 w-8 text-ink-faint" aria-hidden />
      <p className="text-sm text-ink-muted">Drag photos here, or</p>
      <Button variant="secondary" size="sm" loading={busy} onClick={() => input.current?.click()}>
        <Upload className="h-4 w-4" /> {label}
      </Button>
      <p className="text-xs text-ink-faint">JPG, PNG or WebP · up to 5 MB each</p>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple={multiple} className="sr-only" onChange={(e) => { accept(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

// ------------------------------------------------------------------ tabs

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; badge?: ReactNode }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn('-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap', value === t.id ? 'border-brand-700 text-brand-800' : 'border-transparent text-ink-muted hover:text-ink')}
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}
