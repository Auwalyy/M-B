'use client';

import { type InventoryDto, PERMISSIONS } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Boxes, ClipboardCheck, MinusCircle, PackagePlus, Search, Settings2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useDeferredValue, useState } from 'react';
import { BranchSelect, LevelBadge, Thumb } from '@/components/admin/commerce';
import { type StockAction, StockDialog } from '@/components/admin/stock-dialog';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Card, PageHeader } from '@/components/ui/display';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Switch } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useInventory } from '@/lib/queries';
import { cn } from '@/lib/utils';

function EditRow({ row, onClose }: { row: InventoryDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reorder, setReorder] = useState('');
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  if (row && row.id !== seen) {
    setSeen(row.id);
    setReorder(row.reorderLevel === null ? '' : String(row.reorderLevel));
    setAvailable(row.isAvailable);
  }
  if (!row) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${row.product.name}${row.variant ? ` · ${row.variant.label}` : ''}`}
      description={`${row.branch.code} · ${row.branch.name}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.patch(`/inventory/${row.id}`, { reorderLevel: reorder.trim() === '' ? null : Number(reorder), isAvailable: available });
                await qc.invalidateQueries({ queryKey: ['inventory'] });
                toast.success('Saved');
                onClose();
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Reorder level" hint={`You get a low-stock email when available units fall to this number. Empty uses the company default (${row.effectiveReorderLevel}).`}>
          {(p) => <Input {...p} type="number" min={0} value={reorder} onChange={(e) => setReorder(e.target.value)} />}
        </Field>
        <Switch checked={available} onChange={setAvailable} label="Offer at this branch" description="Turn off to hide this item from customers here, even when in stock." />
      </div>
    </Dialog>
  );
}

function InventoryPage() {
  const params = useSearchParams();
  const { user } = useAuth();
  const can = (p: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => Boolean(user?.permissions.includes(p));
  const [branch, setBranch] = useState(params.get('branch') ?? '');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>(params.get('lowStock') === 'true' ? 'low' : 'all');
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<StockAction | null>(null);
  const [editing, setEditing] = useState<InventoryDto | null>(null);
  const search = useDeferredValue(q);
  const product = params.get('product') ?? '';
  const inv = useInventory({ branch, q: search, product, lowStock: filter === 'low' || undefined, outOfStock: filter === 'out' || undefined, page, limit: 50 });

  return (
    <>
      <PageHeader
        title="Stock levels"
        description="Units on hand at each branch. Reserved units are held for customers and cannot be sold again."
        actions={
          <>
            {can(PERMISSIONS.INVENTORY_ADJUST) && <Button variant="secondary" onClick={() => setAction('adjust')}><ClipboardCheck className="h-4 w-4" /> Correct count</Button>}
            {can(PERMISSIONS.INVENTORY_STOCK_OUT) && <Button variant="secondary" onClick={() => setAction('out')}><MinusCircle className="h-4 w-4" /> Remove stock</Button>}
            {can(PERMISSIONS.INVENTORY_STOCK_IN) && <Button onClick={() => setAction('in')}><PackagePlus className="h-4 w-4" /> Receive stock</Button>}
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search product or SKU" className="pl-9" aria-label="Search stock" />
          </div>
          <BranchSelect value={branch} onChange={(b) => { setBranch(b); setPage(1); }} allowAll />
          <div role="group" aria-label="Stock filter" className="inline-flex rounded-lg border border-line bg-surface p-1">
            {(['all', 'low', 'out'] as const).map((f) => (
              <button key={f} onClick={() => { setFilter(f); setPage(1); }} aria-pressed={filter === f} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', filter === f ? 'bg-brand-700 text-white' : 'text-ink-muted hover:text-ink')}>
                {f === 'all' ? 'All' : f === 'low' ? 'Low stock' : 'Out of stock'}
              </button>
            ))}
          </div>
          {product && <Badge tone="info">Filtered to one product</Badge>}
        </div>
        <DataTable<InventoryDto>
          caption="Stock levels"
          rows={inv.data?.data}
          rowKey={(r) => r.id}
          loading={inv.isLoading}
          error={inv.error ? errorMessage(inv.error) : null}
          onRetry={() => inv.refetch()}
          meta={inv.data?.meta}
          onPageChange={setPage}
          empty={{
            icon: Boxes,
            title: filter === 'low' ? 'Nothing is running low' : filter === 'out' ? 'Nothing is out of stock' : 'No stock recorded yet',
            description: filter === 'all' && !q ? 'Use “Receive stock” to record your first delivery.' : undefined,
          }}
          columns={[
            {
              header: 'Product',
              cell: (r) => (
                <div className="flex items-center gap-3">
                  <Thumb url={r.product.image} alt="" size={36} />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{r.product.name}{r.variant && <span className="text-ink-muted"> · {r.variant.label}</span>}</p>
                    <p className="text-xs text-ink-muted">{r.sku}{!r.isAvailable && <Badge className="ml-2">Hidden here</Badge>}</p>
                  </div>
                </div>
              ),
            },
            { header: 'Branch', hideOnMobile: true, cell: (r) => <Badge>{r.branch.code}</Badge> },
            { header: 'On hand', hideOnMobile: true, cell: (r) => <span className="tabular-nums">{r.quantity}</span> },
            { header: 'Reserved', hideOnMobile: true, cell: (r) => <span className="tabular-nums text-ink-muted">{r.reserved}</span> },
            { header: 'Available', cell: (r) => <span className={cn('font-semibold tabular-nums', r.available <= 0 && 'text-danger-700')}>{r.available}</span> },
            { header: 'Reorder at', hideOnMobile: true, cell: (r) => <span className="tabular-nums text-ink-muted">{r.effectiveReorderLevel}{r.reorderLevel === null && '*'}</span> },
            { header: 'Level', cell: (r) => <LevelBadge level={r.level} /> },
            ...(can(PERMISSIONS.INVENTORY_UPDATE)
              ? [{ header: '', cell: (r: InventoryDto) => <Button size="icon" variant="ghost" aria-label={`Settings for ${r.sku} at ${r.branch.code}`} onClick={() => setEditing(r)}><Settings2 className="h-4 w-4" /></Button> }]
              : []),
          ]}
        />
      </Card>
      <p className="mt-3 text-xs text-ink-faint">* Company default reorder level.</p>
      {action && <StockDialog key={action} action={action} open onClose={() => setAction(null)} defaultBranch={branch} />}
      <EditRow row={editing} onClose={() => setEditing(null)} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <InventoryPage />
    </Suspense>
  );
}
