'use client';

import { TRANSFER_STATUSES, type TransferDto } from '@mb/shared';
import { ArrowLeftRight, ArrowRight, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BranchSelect } from '@/components/admin/commerce';
import { TRANSFER_STATUS, TransferStatusBadge } from '@/components/admin/transfer-status';
import { ButtonLink } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Card, PageHeader } from '@/components/ui/display';
import { Select } from '@/components/ui/field';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTransfers } from '@/lib/queries';
import { formatDateTime } from '@/lib/utils';

export default function TransfersPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [status, setStatus] = useState('');
  const [branch, setBranch] = useState('');
  const [page, setPage] = useState(1);
  const transfers = useTransfers({ status, branch, page, limit: 25 });
  const canRequest = Boolean(user?.permissions.includes('inventory:transfer-request') || user?.permissions.includes('inventory:transfer-approve'));

  return (
    <>
      <PageHeader
        title="Stock transfers"
        description="Move stock between branches: request, approve, send, then receive."
        actions={canRequest && <ButtonLink href="/admin/inventory/transfers/new"><Plus className="h-4 w-4" /> Request transfer</ButtonLink>}
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-56" aria-label="Status">
            <option value="">Any status</option>
            {TRANSFER_STATUSES.map((s) => <option key={s} value={s}>{TRANSFER_STATUS[s].label}</option>)}
          </Select>
          <BranchSelect value={branch} onChange={(b) => { setBranch(b); setPage(1); }} allowAll />
        </div>
        <DataTable<TransferDto>
          caption="Stock transfers"
          rows={transfers.data?.data}
          rowKey={(t) => t.id}
          loading={transfers.isLoading}
          error={transfers.error ? errorMessage(transfers.error) : null}
          onRetry={() => transfers.refetch()}
          onRowClick={(t) => router.push(`/admin/inventory/transfers/${t.id}`)}
          meta={transfers.data?.meta}
          onPageChange={setPage}
          empty={{ icon: ArrowLeftRight, title: 'No transfers yet' }}
          columns={[
            { header: 'Reference', cell: (t) => <span className="font-semibold">{t.reference}</span> },
            { header: 'Route', cell: (t) => <span className="inline-flex items-center gap-1.5"><Badge>{t.fromBranch.code}</Badge><ArrowRight className="h-3.5 w-3.5 text-ink-faint" /><Badge>{t.toBranch.code}</Badge></span> },
            { header: 'Items', hideOnMobile: true, cell: (t) => `${t.items.reduce((n, i) => n + i.quantity, 0)} units · ${t.items.length} line${t.items.length === 1 ? '' : 's'}` },
            { header: 'Status', cell: (t) => <span className="inline-flex items-center gap-2"><TransferStatusBadge status={t.status} />{t.allowedActions.some((a) => a !== 'cancel') && <Badge tone="brand">Your action</Badge>}</span> },
            { header: 'Updated', hideOnMobile: true, cell: (t) => <span className="text-ink-muted">{formatDateTime(t.updatedAt)}</span> },
          ]}
        />
      </Card>
    </>
  );
}
