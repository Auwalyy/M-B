'use client';

import {
  type CustomerReportRow,
  type CustomerReportSummary,
  type InventoryReportRow,
  type InventoryReportSummary,
  PERMISSIONS,
  type PaymentReportRow,
  type PaymentReportSummary,
  type ReportPage,
  type SalesReportRow,
  type SalesReportSummary,
  formatNaira,
} from '@mb/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Boxes, CreditCard, Download, Receipt, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, Suspense, useEffect, useState } from 'react';
import { ReportFilters, type ReportFilter, useReportFilter } from '@/components/admin/report-filters';
import { OrderStatusBadge } from '@/components/store/order-status';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/display';
import { type Column, DataTable } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { type Query, api, downloadFile, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn, formatDate, formatDateTime } from '@/lib/utils';

type Kind = 'sales' | 'inventory' | 'customers' | 'payments';
const CHANNEL: Record<string, string> = { online: 'Online', in_store: 'In store', whatsapp: 'WhatsApp', phone: 'Phone' };
const METHOD: Record<string, string> = { cash: 'Cash', pos: 'Card (POS)', bank_transfer: 'Bank transfer', paystack: 'Card (online)', pay_on_pickup: 'Pay on pickup', pay_on_delivery: 'Pay on delivery' };

function Summary({ items }: { items: { label: string; value: ReactNode; hint?: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden border-b border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
      {items.map((i) => (
        <div key={i.label} className="bg-surface px-5 py-4">
          <dt className="text-xs font-medium text-ink-muted">{i.label}</dt>
          <dd className="mt-1 text-lg font-semibold text-ink tabular-nums">{i.value}</dd>
          {i.hint && <dd className="text-xs text-ink-muted">{i.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** Fetches one page of a report and offers the full CSV for the same filters. */
function useReport<Row, S>(kind: Kind, query: Query, page: number, enabled = true) {
  const q = { ...query, page, limit: 25 };
  return useQuery({ queryKey: ['reports', kind, q], queryFn: () => api.get<ReportPage<Row, S>>(`/reports/${kind}`, q), placeholderData: keepPreviousData, enabled });
}

function ExportButton({ kind, query }: { kind: Kind; query: Query }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadFile(`/reports/${kind}`, { ...query, format: 'csv' }, `${kind}.csv`);
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download className="h-4 w-4" /> Download CSV
    </Button>
  );
}

const pageMeta = (d?: { page: number; limit: number; total: number; pages: number }) => (d ? { page: d.page, limit: d.limit, total: d.total, pages: d.pages } : undefined);

function SalesReport({ query }: { query: Query }) {
  const [page, setPage] = useState(1);
  const [channel, setChannel] = useState('');
  const q = { ...query, channel };
  useEffect(() => setPage(1), [JSON.stringify(q)]);
  const r = useReport<SalesReportRow, SalesReportSummary>('sales', q, page);
  const s = r.data?.summary;
  const columns: Column<SalesReportRow>[] = [
    { header: 'Order', cell: (o) => <div><Link href={`/admin/orders/${o.id}`} className="font-medium text-brand-700 hover:underline">{o.reference}</Link><p className="text-xs text-ink-muted">{formatDateTime(o.confirmedAt)}</p></div> },
    { header: 'Branch', hideOnMobile: true, cell: (o) => o.branch.code },
    { header: 'Customer', hideOnMobile: true, cell: (o) => <div><p>{o.customerName}</p><p className="text-xs text-ink-muted">{CHANNEL[o.channel]} · {o.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}</p></div> },
    { header: 'Total', className: 'text-right', cell: (o) => <div className="tabular-nums"><p className="font-semibold">{formatNaira(o.total)}</p>{o.discount > 0 && <p className="text-xs text-ink-muted">−{formatNaira(o.discount)} discount</p>}</div> },
    { header: 'Owed', className: 'text-right', hideOnMobile: true, cell: (o) => <span className={cn('tabular-nums', o.outstanding > 0 && 'font-medium text-warning-700')}>{o.outstanding ? formatNaira(o.outstanding) : '—'}</span> },
    { header: 'Status', cell: (o) => <OrderStatusBadge status={o.status} /> },
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line p-4">
        <Select value={channel} onChange={(e) => setChannel(e.target.value)} className="w-40" aria-label="Channel"><option value="">Every channel</option>{Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <ExportButton kind="sales" query={q} />
      </div>
      {s && (
        <Summary
          items={[
            { label: 'Gross sales', value: formatNaira(s.grossSales), hint: `${s.orders} order${s.orders === 1 ? '' : 's'}` },
            { label: 'Average order', value: formatNaira(s.orders ? Math.round(s.grossSales / s.orders) : 0) },
            { label: 'Discounts given', value: formatNaira(s.discounts), hint: `Delivery fees ${formatNaira(s.deliveryFees)}` },
            { label: 'Paid on these orders', value: formatNaira(s.paidOnOrders) },
            { label: 'Still owed', value: formatNaira(s.outstanding), hint: s.byChannel.map((c) => `${CHANNEL[c.channel]} ${formatNaira(c.grossSales)}`).join(' · ') },
          ]}
        />
      )}
      <DataTable caption="Sales report" columns={columns} rows={r.data?.rows} rowKey={(o) => o.id} loading={r.isLoading} error={r.error ? errorMessage(r.error) : null} meta={pageMeta(r.data)} onPageChange={setPage} empty={{ icon: Receipt, title: 'No sales in this period', description: 'Orders appear here once a branch confirms them.' }} />
    </Card>
  );
}

function InventoryReport({ query }: { query: Query }) {
  const [page, setPage] = useState(1);
  const [stock, setStock] = useState('all');
  const [search, setSearch] = useState('');
  const q = { branch: query.branch, stock, q: search.trim() || undefined };
  useEffect(() => setPage(1), [JSON.stringify(q)]);
  const r = useReport<InventoryReportRow, InventoryReportSummary>('inventory', q, page);
  const s = r.data?.summary;
  const showCost = s?.costValue != null;
  const columns: Column<InventoryReportRow>[] = [
    { header: 'Product', cell: (i) => <div><p className="font-medium">{i.product.name}{i.variantLabel && <span className="text-ink-muted"> · {i.variantLabel}</span>}</p><p className="text-xs text-ink-muted">{i.sku} · {i.branch.code}</p></div> },
    { header: 'On hand', className: 'text-right', cell: (i) => <span className="tabular-nums">{i.quantity}{i.reserved > 0 && <span className="block text-xs text-ink-muted">{i.reserved} held</span>}</span> },
    { header: 'Available', className: 'text-right', cell: (i) => <Badge tone={i.stock === 'out' ? 'danger' : i.stock === 'low' ? 'warning' : 'neutral'}>{i.stock === 'out' ? 'Out' : i.available}</Badge> },
    { header: 'Retail value', className: 'text-right', hideOnMobile: true, cell: (i) => <span className="tabular-nums">{formatNaira(i.retailValue)}</span> },
    ...(showCost ? [{ header: 'Cost value', className: 'text-right', hideOnMobile: true, cell: (i: InventoryReportRow) => <span className="tabular-nums">{i.costValue === null ? <span className="text-ink-muted">No cost price</span> : formatNaira(i.costValue)}</span> }] : []),
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line p-4">
        <div className="flex flex-wrap gap-3">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Product or SKU" className="w-56" aria-label="Search stock" />
          <Select value={stock} onChange={(e) => setStock(e.target.value)} className="w-44" aria-label="Stock level"><option value="all">All stock lines</option><option value="low">Low or out of stock</option><option value="out">Out of stock</option></Select>
        </div>
        <ExportButton kind="inventory" query={q} />
      </div>
      {s && (
        <Summary
          items={[
            { label: 'Stock lines', value: s.lines.toLocaleString('en-NG'), hint: `${s.low} low · ${s.out} out` },
            { label: 'Units on hand', value: s.units.toLocaleString('en-NG'), hint: `${s.reserved.toLocaleString('en-NG')} held for customers` },
            { label: 'Retail value', value: formatNaira(s.retailValue), hint: 'At current selling prices' },
            ...(s.costValue !== null ? [{ label: 'Value at cost', value: formatNaira(s.costValue), hint: s.linesWithoutCost ? `${s.linesWithoutCost} lines have no cost price` : undefined }] : []),
          ]}
        />
      )}
      <DataTable caption="Inventory report" columns={columns} rows={r.data?.rows} rowKey={(i) => i.id} loading={r.isLoading} error={r.error ? errorMessage(r.error) : null} meta={pageMeta(r.data)} onPageChange={setPage} empty={{ icon: Boxes, title: 'No stock lines match' }} />
    </Card>
  );
}

function CustomersReport({ query }: { query: Query }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('spent');
  const q = { ...query, sort };
  useEffect(() => setPage(1), [JSON.stringify(q)]);
  const r = useReport<CustomerReportRow, CustomerReportSummary>('customers', q, page);
  const s = r.data?.summary;
  const columns: Column<CustomerReportRow>[] = [
    { header: 'Customer', cell: (c) => <div><Link href={`/admin/customers/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.fullName}</Link>{c.isNew && <Badge tone="info" className="ml-2">New</Badge>}<p className="text-xs text-ink-muted">{c.phone}</p></div> },
    { header: 'Orders', className: 'text-right', cell: (c) => <span className="tabular-nums">{c.orders}</span> },
    { header: 'Spent', className: 'text-right', cell: (c) => <span className="font-semibold tabular-nums">{formatNaira(c.spent)}</span> },
    { header: 'Average', className: 'text-right', hideOnMobile: true, cell: (c) => <span className="tabular-nums">{formatNaira(c.averageOrderValue)}</span> },
    { header: 'Last order', hideOnMobile: true, cell: (c) => <span>{formatDate(c.lastOrderAt)}<span className="block text-xs text-ink-muted">{c.branches.join(', ')}</span></span> },
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line p-4">
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-48" aria-label="Sort by"><option value="spent">Most spent first</option><option value="orders">Most orders first</option><option value="recent">Most recent first</option></Select>
        <ExportButton kind="customers" query={q} />
      </div>
      {s && (
        <Summary
          items={[
            { label: 'Buying customers', value: s.customers.toLocaleString('en-NG') },
            { label: 'New customers', value: s.newCustomers.toLocaleString('en-NG'), hint: 'First recorded in this period' },
            { label: 'Repeat customers', value: s.repeatCustomers.toLocaleString('en-NG'), hint: 'Two or more orders' },
            { label: 'Orders', value: s.orders.toLocaleString('en-NG') },
            { label: 'Spent', value: formatNaira(s.spent), hint: `${formatNaira(s.customers ? Math.round(s.spent / s.customers) : 0)} per customer` },
          ]}
        />
      )}
      <DataTable caption="Customer report" columns={columns} rows={r.data?.rows} rowKey={(c) => c.id} loading={r.isLoading} error={r.error ? errorMessage(r.error) : null} meta={pageMeta(r.data)} onPageChange={setPage} empty={{ icon: UserRound, title: 'No customers bought in this period' }} />
    </Card>
  );
}

function PaymentsReport({ query }: { query: Query }) {
  const [page, setPage] = useState(1);
  const [method, setMethod] = useState('');
  const q = { ...query, method };
  useEffect(() => setPage(1), [JSON.stringify(q)]);
  const r = useReport<PaymentReportRow, PaymentReportSummary>('payments', q, page);
  const s = r.data?.summary;
  const columns: Column<PaymentReportRow>[] = [
    { header: 'Payment', cell: (p) => <div><p className="font-medium">{p.receiptNumber ?? p.reference}</p><p className="text-xs text-ink-muted">{formatDateTime(p.verifiedAt)} · {p.branch.code}</p></div> },
    { header: 'Order', hideOnMobile: true, cell: (p) => <div><p>{p.orderReference}</p><p className="text-xs text-ink-muted">{p.customerName}</p></div> },
    { header: 'Method', hideOnMobile: true, cell: (p) => <div><p>{METHOD[p.method] ?? p.method}</p>{p.verifiedBy && <p className="text-xs text-ink-muted">Checked by {p.verifiedBy}</p>}</div> },
    { header: 'Amount', className: 'text-right', cell: (p) => <div className="tabular-nums"><p className="font-semibold">{formatNaira(p.amount)}</p>{p.refunded > 0 && <p className="text-xs text-danger-700">−{formatNaira(p.refunded)} refunded</p>}</div> },
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line p-4">
        <Select value={method} onChange={(e) => setMethod(e.target.value)} className="w-44" aria-label="Method"><option value="">Every method</option>{Object.entries(METHOD).slice(0, 4).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <ExportButton kind="payments" query={q} />
      </div>
      {s && (
        <Summary
          items={[
            { label: 'Collected revenue', value: formatNaira(s.collectedRevenue), hint: 'Received less refunds' },
            { label: 'Received', value: formatNaira(s.received), hint: `${s.payments} payment${s.payments === 1 ? '' : 's'}` },
            { label: 'Refunded', value: formatNaira(s.refunds), hint: 'Refunds made in this period' },
            ...s.byMethod.slice(0, 2).map((m) => ({ label: METHOD[m.method] ?? m.method, value: formatNaira(m.amount), hint: `${m.payments} payment${m.payments === 1 ? '' : 's'}` })),
          ]}
        />
      )}
      <DataTable caption="Payment report" columns={columns} rows={r.data?.rows} rowKey={(p) => p.id} loading={r.isLoading} error={r.error ? errorMessage(r.error) : null} meta={pageMeta(r.data)} onPageChange={setPage} empty={{ icon: CreditCard, title: 'No payments received in this period' }} />
    </Card>
  );
}

function Reports() {
  const [filter, setFilter, params] = useReportFilter();
  const router = useRouter();
  const pathname = usePathname();
  const financial = useCan(PERMISSIONS.REPORTS_FINANCIAL);
  const tabs: { key: Kind; label: string }[] = [
    { key: 'sales', label: 'Sales' },
    { key: 'inventory', label: 'Inventory' },
    { key: 'customers', label: 'Customers' },
    ...(financial ? [{ key: 'payments' as const, label: 'Payments' }] : []),
  ];
  const requested = params.get('report') as Kind | null;
  const kind: Kind = tabs.some((t) => t.key === requested) ? requested! : 'sales';
  const query = (f: ReportFilter): Query => ({ from: f.from, to: f.to, branch: f.branch || undefined });
  const go = (k: Kind) => {
    const next = new URLSearchParams(params);
    next.set('report', k);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <>
      <div role="tablist" aria-label="Reports" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={kind === t.key}
            onClick={() => go(t.key)}
            className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap', kind === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-muted hover:text-ink')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ReportFilters filter={filter} onChange={setFilter} showRange={kind !== 'inventory'} />
      {kind === 'sales' && <SalesReport query={query(filter)} />}
      {kind === 'inventory' && <InventoryReport query={query(filter)} />}
      {kind === 'customers' && <CustomersReport query={query(filter)} />}
      {kind === 'payments' && <PaymentsReport query={query(filter)} />}
      <p className="mt-4 text-xs text-ink-muted">
        {kind === 'inventory'
          ? 'Stock as it stands now. Downloads include every matching line.'
          : `Dates are Lagos time, ${filter.from} to ${filter.to}. Downloads include every matching row (up to 50,000) and are recorded in the activity log.`}
      </p>
    </>
  );
}

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" description="Sales, stock, customers and payments for your branches, with spreadsheet downloads." />
      <Suspense>
        <Reports />
      </Suspense>
    </>
  );
}
