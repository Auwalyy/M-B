'use client';

import { PERMISSIONS, RESERVATION_STATUSES, type ReservationDto, formatNaira, formatPhone } from '@mb/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarClock, Plus, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { BranchSelect } from '@/components/admin/commerce';
import { RESERVATION_STATUS, ReservationStatusBadge } from '@/components/reservation-status';
import { ButtonLink } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Card, PageHeader } from '@/components/ui/display';
import { Input, Select } from '@/components/ui/field';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { formatDateTime, timeAgo } from '@/lib/utils';

export default function ReservationsPage() {
  const router = useRouter();
  const canCreate = useCan(PERMISSIONS.RESERVATIONS_CREATE);
  const [status, setStatus] = useState('pending');
  const [branch, setBranch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const search = useDeferredValue(q);
  const query = { status, branch, q: search, page, limit: 25 };
  const list = useQuery({ queryKey: ['reservations', query], queryFn: () => api.page<ReservationDto>('/reservations', query), placeholderData: keepPreviousData, refetchInterval: 60_000 });

  return (
    <>
      <PageHeader
        title="Reservations"
        description="Customers reserving items to collect. Stock is held from the moment they reserve. Confirm quickly so they know it is ready."
        actions={canCreate && <ButtonLink href="/admin/reservations/new"><Plus className="h-4 w-4" /> Reserve for a customer</ButtonLink>}
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Reference, name or phone" className="pl-9" aria-label="Search reservations" />
          </div>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-52" aria-label="Status">
            <option value="">Any status</option>
            {RESERVATION_STATUSES.map((s) => <option key={s} value={s}>{RESERVATION_STATUS[s].label}</option>)}
          </Select>
          <BranchSelect value={branch} onChange={(b) => { setBranch(b); setPage(1); }} allowAll />
        </div>
        <DataTable<ReservationDto>
          caption="Reservations"
          rows={list.data?.data}
          rowKey={(r) => r.id}
          loading={list.isLoading}
          error={list.error ? errorMessage(list.error) : null}
          onRetry={() => list.refetch()}
          onRowClick={(r) => router.push(`/admin/reservations/${r.id}`)}
          meta={list.data?.meta}
          onPageChange={setPage}
          empty={{ icon: CalendarClock, title: status === 'pending' ? 'Nothing waiting for confirmation' : 'No reservations' }}
          columns={[
            { header: 'Reservation', cell: (r) => <div><p className={r.status === 'pending' ? 'font-bold' : 'font-medium'}>{r.reference}</p><p className="text-xs text-ink-muted">{timeAgo(r.createdAt)} · {r.channel.replace('_', ' ')}</p></div> },
            { header: 'Customer', cell: (r) => <div className="text-sm">{r.customer.fullName}<p className="text-xs text-ink-muted">{formatPhone(r.customer.phone)}</p></div> },
            { header: 'Items', hideOnMobile: true, cell: (r) => <span className="text-sm">{r.items.map((i) => `${i.quantity}× ${i.product.name}`).join(', ')}</span> },
            { header: 'Value', hideOnMobile: true, cell: (r) => <span className="tabular-nums">{formatNaira(r.total)}</span> },
            { header: 'Holds until', hideOnMobile: true, cell: (r) => (r.expiresAt && ['pending', 'confirmed'].includes(r.status) ? <span className="text-sm text-ink-muted">{formatDateTime(r.expiresAt)}</span> : '—') },
            { header: 'Status', cell: (r) => <span className="inline-flex items-center gap-2"><ReservationStatusBadge status={r.status} />{r.branch.code && <Badge>{r.branch.code}</Badge>}</span> },
          ]}
        />
      </Card>
    </>
  );
}
