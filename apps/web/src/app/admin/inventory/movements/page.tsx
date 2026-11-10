'use client';

import { MOVEMENT_TYPES, type MovementDto, type MovementType } from '@mb/shared';
import { ScrollText, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { BranchSelect } from '@/components/admin/commerce';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Card, PageHeader, type Tone } from '@/components/ui/display';
import { Input, Select } from '@/components/ui/field';
import { errorMessage } from '@/lib/api';
import { useMovements } from '@/lib/queries';
import { cn, formatDateTime } from '@/lib/utils';

const MOVEMENT_LABEL: Record<MovementType, { label: string; tone: Tone }> = {
  stock_in: { label: 'Received', tone: 'success' },
  stock_out: { label: 'Removed', tone: 'danger' },
  adjustment: { label: 'Count correction', tone: 'warning' },
  transfer_out: { label: 'Transferred out', tone: 'info' },
  transfer_in: { label: 'Transferred in', tone: 'info' },
  sale: { label: 'Sold', tone: 'brand' },
  reservation_hold: { label: 'Reserved', tone: 'accent' },
  reservation_release: { label: 'Reservation released', tone: 'neutral' },
  return: { label: 'Returned', tone: 'success' },
};

export default function MovementsPage() {
  const [branch, setBranch] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const search = useDeferredValue(q);
  const moves = useMovements({ branch, type, q: search, page, limit: 50 });

  return (
    <>
      <PageHeader title="Stock history" description="Every change to stock, who made it and why. This record cannot be edited." />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="SKU" className="pl-9" aria-label="Filter by SKU" />
          </div>
          <BranchSelect value={branch} onChange={(b) => { setBranch(b); setPage(1); }} allowAll />
          <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="w-48" aria-label="Movement type">
            <option value="">All movements</option>
            {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{MOVEMENT_LABEL[t].label}</option>)}
          </Select>
        </div>
        <DataTable<MovementDto>
          caption="Stock history"
          rows={moves.data?.data}
          rowKey={(m) => m.id}
          loading={moves.isLoading}
          error={moves.error ? errorMessage(moves.error) : null}
          onRetry={() => moves.refetch()}
          meta={moves.data?.meta}
          onPageChange={setPage}
          empty={{ icon: ScrollText, title: 'No stock movements yet' }}
          columns={[
            { header: 'When', cell: (m) => <span className="whitespace-nowrap text-ink-muted">{formatDateTime(m.createdAt)}</span> },
            { header: 'Product', cell: (m) => <span><span className="font-medium">{m.product.name}</span>{m.variant && <span className="text-ink-muted"> · {m.variant.label}</span>}<span className="block text-xs text-ink-faint">{m.sku}</span></span> },
            { header: 'Branch', hideOnMobile: true, cell: (m) => <Badge>{m.branch.code}</Badge> },
            { header: 'Type', cell: (m) => <Badge tone={MOVEMENT_LABEL[m.type].tone}>{MOVEMENT_LABEL[m.type].label}</Badge> },
            { header: 'Change', cell: (m) => <span className={cn('font-semibold tabular-nums', m.quantityDelta > 0 ? 'text-success-700' : 'text-danger-700')}>{m.quantityDelta > 0 ? '+' : ''}{m.quantityDelta}</span> },
            { header: 'Balance', hideOnMobile: true, cell: (m) => <span className="tabular-nums">{m.balanceAfter}</span> },
            { header: 'By / reference', hideOnMobile: true, cell: (m) => <span className="text-xs text-ink-muted">{m.performedBy?.fullName ?? 'System'}{m.reference?.label && ` · ${m.reference.label}`}{m.reason && <span className="block">{m.reason}</span>}</span> },
          ]}
        />
      </Card>
    </>
  );
}
