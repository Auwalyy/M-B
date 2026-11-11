'use client';

import { DELIVERY_STATUSES, type DeliveryDto, formatNaira, formatPhone } from '@mb/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bike } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BranchSelect } from '@/components/admin/commerce';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Card, PageHeader, type Tone } from '@/components/ui/display';
import { Select } from '@/components/ui/field';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/utils';

const LABEL: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Needs a rider', tone: 'warning' }, assigned: { label: 'Rider assigned', tone: 'info' }, picked_up: { label: 'Picked up', tone: 'accent' },
  in_transit: { label: 'On the way', tone: 'accent' }, delivered: { label: 'Delivered', tone: 'success' }, failed: { label: 'Failed', tone: 'danger' }, returned: { label: 'Returned', tone: 'neutral' },
};

export default function DeliveriesPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [branch, setBranch] = useState('');
  const [page, setPage] = useState(1);
  const query = { status, branch, page, limit: 25 };
  const list = useQuery({ queryKey: ['deliveries', query], queryFn: () => api.page<DeliveryDto>('/deliveries', query), placeholderData: keepPreviousData, refetchInterval: 60_000 });

  return (
    <>
      <PageHeader title="Deliveries" description="Assign riders and track deliveries. Open an order to update its delivery." />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-48" aria-label="Status">
            <option value="">Any status</option>
            {DELIVERY_STATUSES.map((s) => <option key={s} value={s}>{LABEL[s]!.label}</option>)}
          </Select>
          <BranchSelect value={branch} onChange={(b) => { setBranch(b); setPage(1); }} allowAll />
        </div>
        <DataTable<DeliveryDto>
          caption="Deliveries"
          rows={list.data?.data}
          rowKey={(d) => d.id}
          loading={list.isLoading}
          error={list.error ? errorMessage(list.error) : null}
          onRowClick={(d) => router.push(`/admin/orders/${d.order.id}`)}
          meta={list.data?.meta}
          onPageChange={setPage}
          empty={{ icon: Bike, title: 'No deliveries' }}
          columns={[
            { header: 'Order', cell: (d) => <div><p className="font-medium">{d.order.reference}</p><p className="text-xs text-ink-muted">{timeAgo(d.updatedAt)}</p></div> },
            { header: 'Deliver to', cell: (d) => <div className="text-sm">{d.customer.fullName} · {formatPhone(d.customer.phone)}<p className="text-xs text-ink-muted">{d.address.line1}{d.address.area ? `, ${d.address.area}` : ''}, {d.address.city}</p></div> },
            { header: 'Rider', hideOnMobile: true, cell: (d) => d.assignedTo?.name ?? '—' },
            { header: 'To collect', hideOnMobile: true, cell: (d) => (d.order.outstanding > 0 ? <span className="font-semibold text-warning-700">{formatNaira(d.order.outstanding)}</span> : <span className="text-ink-muted">Paid</span>) },
            { header: 'Status', cell: (d) => <span className="inline-flex gap-2"><Badge tone={LABEL[d.status]!.tone} dot>{LABEL[d.status]!.label}</Badge><Badge>{d.branch.code}</Badge></span> },
          ]}
        />
      </Card>
    </>
  );
}
