'use client';

import { ORDER_STATUSES, type OrderDto, PERMISSIONS, formatNaira, formatPhone } from '@mb/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Receipt, Search, Store, Truck } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { useCan } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { BranchSelect } from '@/components/admin/commerce';
import { ORDER_STATUS, OrderStatusBadge } from '@/components/store/order-status';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Card, PageHeader } from '@/components/ui/display';
import { Input, Select } from '@/components/ui/field';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/utils';

export default function OrdersPage() {
  const router = useRouter();
  const canCreate = useCan(PERMISSIONS.ORDERS_CREATE);
  const [status, setStatus] = useState('');
  const [branch, setBranch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const search = useDeferredValue(q);
  const query = { status, branch, q: search, page, limit: 25 };
  const orders = useQuery({ queryKey: ['orders', query], queryFn: () => api.page<OrderDto>('/orders', query), placeholderData: keepPreviousData, refetchInterval: 60_000 });

  return (
    <>
      <PageHeader title="Orders" description="Online orders for your branches. Stock is held for every open order until it is completed or cancelled." actions={canCreate && <ButtonLink href="/admin/orders/new"><Plus className="h-4 w-4" /> New order</ButtonLink>} />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Order number, name or phone" className="pl-9" aria-label="Search orders" />
          </div>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-44" aria-label="Status">
            <option value="">Any status</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS[s].label}</option>)}
          </Select>
          <BranchSelect value={branch} onChange={(b) => { setBranch(b); setPage(1); }} allowAll />
        </div>
        <DataTable<OrderDto>
          caption="Orders"
          rows={orders.data?.data}
          rowKey={(o) => o.id}
          loading={orders.isLoading}
          error={orders.error ? errorMessage(orders.error) : null}
          onRetry={() => orders.refetch()}
          onRowClick={(o) => router.push(`/admin/orders/${o.id}`)}
          meta={orders.data?.meta}
          onPageChange={setPage}
          empty={{ icon: Receipt, title: 'No orders yet', description: 'Orders placed on the website appear here.' }}
          columns={[
            { header: 'Order', cell: (o) => <div><p className={o.status === 'pending' ? 'font-bold' : 'font-medium'}>{o.reference}</p><p className="text-xs text-ink-muted">{timeAgo(o.createdAt)} · {o.channel.replace('_', ' ')}</p></div> },
            { header: 'Balance', hideOnMobile: true, cell: (o) => (o.outstanding > 0 && !['cancelled', 'refunded'].includes(o.status) ? <span className="text-sm font-semibold text-warning-700">{formatNaira(o.outstanding)}</span> : <span className="text-sm text-ink-muted">Paid</span>) },
            { header: 'Customer', cell: (o) => <div className="text-sm">{o.customer.fullName}<p className="text-xs text-ink-muted">{formatPhone(o.customer.phone)}</p></div> },
            { header: 'Branch', hideOnMobile: true, cell: (o) => <Badge>{o.branch.code}</Badge> },
            { header: 'How', hideOnMobile: true, cell: (o) => (o.fulfilment.method === 'pickup' ? <span className="inline-flex items-center gap-1 text-sm"><Store className="h-4 w-4" /> Pickup</span> : <span className="inline-flex items-center gap-1 text-sm"><Truck className="h-4 w-4" /> Delivery</span>) },
            { header: 'Total', cell: (o) => <span className="font-semibold tabular-nums">{formatNaira(o.total)}</span> },
            { header: 'Status', cell: (o) => <OrderStatusBadge status={o.status} /> },
          ]}
        />
      </Card>
    </>
  );
}
