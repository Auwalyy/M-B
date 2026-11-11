'use client';

import { PERMISSIONS, type PaymentDto, formatNaira } from '@mb/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Search } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { BranchSelect } from '@/components/admin/commerce';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Card, PageHeader, type Tone } from '@/components/ui/display';
import { Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

const METHOD: Record<string, string> = { cash: 'Cash', pos: 'Card (POS)', bank_transfer: 'Bank transfer', paystack: 'Card (online)' };
const STATUS: Record<string, { label: string; tone: Tone }> = { pending: { label: 'Pending', tone: 'warning' }, success: { label: 'Received', tone: 'success' }, failed: { label: 'Failed', tone: 'danger' }, abandoned: { label: 'Abandoned', tone: 'neutral' }, reversed: { label: 'Reversed', tone: 'neutral' } };

export default function PaymentsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const canConfirm = useCan(PERMISSIONS.PAYMENTS_CONFIRM);
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [branch, setBranch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const search = useDeferredValue(q);
  const query = { status, method, branch, q: search, page, limit: 25 };
  const list = useQuery({ queryKey: ['payments', query], queryFn: () => api.page<PaymentDto>('/payments', query), placeholderData: keepPreviousData });
  const review = async (p: PaymentDto, decision: 'confirm' | 'reject') => {
    try {
      await api.post(`/payments/${p.id}/${decision}`, {});
      toast.success(decision === 'confirm' ? 'Transfer confirmed' : 'Marked as not received');
      void qc.invalidateQueries({ queryKey: ['payments'] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader title="Payments" description="Money received across your branches. Bank transfers recorded by sales staff wait here until checked against the bank account." />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Payment, receipt or transfer reference" className="pl-9" aria-label="Search payments" />
          </div>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-36" aria-label="Status"><option value="">Any status</option><option value="pending">Pending</option><option value="success">Received</option><option value="failed">Failed</option></Select>
          <Select value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }} className="w-40" aria-label="Method"><option value="">Any method</option>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <BranchSelect value={branch} onChange={(b) => { setBranch(b); setPage(1); }} allowAll />
        </div>
        <DataTable<PaymentDto>
          caption="Payments"
          rows={list.data?.data}
          rowKey={(p) => p.id}
          loading={list.isLoading}
          error={list.error ? errorMessage(list.error) : null}
          meta={list.data?.meta}
          onPageChange={setPage}
          empty={{ icon: CreditCard, title: 'No payments found' }}
          columns={[
            { header: 'Payment', cell: (p) => <div><p className="font-medium">{p.receiptNumber ?? p.reference}</p><p className="text-xs text-ink-muted">{formatDateTime(p.verifiedAt ?? p.createdAt)}</p></div> },
            { header: 'Order', cell: (p) => <Link href={`/admin/orders/${p.order.id}`} className="text-brand-700 hover:underline">{p.order.reference}</Link> },
            { header: 'Customer', hideOnMobile: true, cell: (p) => p.customer.fullName },
            { header: 'Method', hideOnMobile: true, cell: (p) => <span className="text-sm">{METHOD[p.method] ?? p.method}{p.providerReference && <span className="block text-xs text-ink-muted">{p.providerReference}</span>}</span> },
            { header: 'Amount', cell: (p) => <span className="font-semibold tabular-nums">{formatNaira(p.amount)}{p.refundedAmount > 0 && <span className="block text-xs font-normal text-danger-700">−{formatNaira(p.refundedAmount)} refunded</span>}</span> },
            {
              header: 'Status',
              cell: (p) =>
                p.status === 'pending' && p.method === 'bank_transfer' && canConfirm ? (
                  <span className="flex gap-1"><Button size="sm" onClick={() => review(p, 'confirm')}>Confirm</Button><Button size="sm" variant="ghost" onClick={() => review(p, 'reject')}>Not received</Button></span>
                ) : (
                  <Badge tone={STATUS[p.status]!.tone} dot>{STATUS[p.status]!.label}</Badge>
                ),
            },
          ]}
        />
      </Card>
    </>
  );
}
