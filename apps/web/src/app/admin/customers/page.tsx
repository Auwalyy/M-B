'use client';

import { CUSTOMER_SOURCES, type CustomerDto, PERMISSIONS, formatPhone } from '@mb/shared';
import { Search, UserPlus, UserRound } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useDeferredValue, useState } from 'react';
import { SOURCE_LABEL } from '@/components/admin/badges';
import { BranchSelect, Money } from '@/components/admin/commerce';
import { ButtonLink } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Card, PageHeader } from '@/components/ui/display';
import { Input, Select } from '@/components/ui/field';
import { errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useCustomers, useSegments } from '@/lib/queries';
import { formatDate } from '@/lib/utils';

function CustomersList() {
  const router = useRouter();
  const params = useSearchParams();
  const canCreate = useCan(PERMISSIONS.CUSTOMERS_CREATE);
  const [q, setQ] = useState('');
  const [branch, setBranch] = useState('');
  const [segment, setSegment] = useState(params.get('segment') ?? '');
  const [source, setSource] = useState('');
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  const search = useDeferredValue(q);
  const customers = useCustomers({ q: search, branch, segment, source, sort, page, limit: 25 });
  const segments = useSegments();
  const reset = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); };
  const filtered = Boolean(q || branch || segment || source);

  return (
    <>
      <PageHeader
        title="Customers"
        description="One record per customer, shared by every branch that serves them."
        actions={canCreate && <ButtonLink href="/admin/customers/new"><UserPlus className="h-4 w-4" /> Register customer</ButtonLink>}
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Name, phone or email" className="pl-9" aria-label="Search customers" />
          </div>
          <BranchSelect value={branch} onChange={reset(setBranch)} allowAll />
          {(segments.data?.length ?? 0) > 0 && (
            <Select value={segment} onChange={(e) => reset(setSegment)(e.target.value)} className="w-48" aria-label="Segment">
              <option value="">All customers</option>
              {segments.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
          <Select value={source} onChange={(e) => reset(setSource)(e.target.value)} className="w-40" aria-label="Source">
            <option value="">Any source</option>
            {CUSTOMER_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </Select>
          <Select value={sort} onChange={(e) => reset(setSort)(e.target.value)} className="w-40" aria-label="Sort">
            <option value="recent">Newest first</option>
            <option value="name">Name A–Z</option>
            <option value="top_spenders">Top spenders</option>
          </Select>
        </div>
        <DataTable<CustomerDto>
          caption="Customers"
          rows={customers.data?.data}
          rowKey={(c) => c.id}
          loading={customers.isLoading}
          error={customers.error ? errorMessage(customers.error) : null}
          onRetry={() => customers.refetch()}
          onRowClick={(c) => router.push(`/admin/customers/${c.id}`)}
          meta={customers.data?.meta}
          onPageChange={setPage}
          empty={{
            icon: UserRound,
            title: filtered ? 'No customers match' : 'No customers yet',
            action: canCreate && !filtered ? <ButtonLink href="/admin/customers/new"><UserPlus className="h-4 w-4" /> Register customer</ButtonLink> : undefined,
          }}
          columns={[
            { header: 'Customer', cell: (c) => <div><p className="font-semibold">{c.fullName}{c.hasAccount && <Badge tone="info" className="ml-2">Online account</Badge>}</p><p className="text-xs text-ink-muted">{formatPhone(c.phone)}{c.email ? ` · ${c.email}` : ''}</p></div> },
            { header: 'Branches', hideOnMobile: true, cell: (c) => <div className="flex flex-wrap gap-1">{c.branchesServed.map((b) => <Badge key={b.id}>{b.code}</Badge>)}</div> },
            { header: 'Tags', hideOnMobile: true, cell: (c) => <div className="flex flex-wrap gap-1">{c.tags.map((t) => <Badge key={t} tone="accent">{t}</Badge>)}</div> },
            { header: 'Spent', hideOnMobile: true, cell: (c) => <Money kobo={c.stats.totalSpent} /> },
            { header: 'Since', hideOnMobile: true, cell: (c) => <span className="text-ink-muted">{formatDate(c.createdAt)}</span> },
          ]}
        />
      </Card>
    </>
  );
}

export default function CustomersPage() {
  return (
    <Suspense>
      <CustomersList />
    </Suspense>
  );
}
