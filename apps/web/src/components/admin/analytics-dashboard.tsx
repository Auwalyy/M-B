'use client';

import {
  type AnalyticsOverviewDto,
  type BranchPerformanceReportDto,
  type InventoryDto,
  type RecentTransactionsDto,
  type ReportGrouping,
  type SalesSeriesDto,
  type TopProductsDto,
  daysInRange,
  formatNaira,
} from '@mb/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Bike, CalendarClock, ClipboardList, CreditCard, FileBarChart, MessageSquare, PackageX } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BarList, SalesChart, StatTile, compactNaira } from '@/components/admin/charts';
import { ReportFilters, useReportFilter } from '@/components/admin/report-filters';
import { OrderStatusBadge } from '@/components/store/order-status';
import { ButtonLink } from '@/components/ui/button';
import { Alert, Badge, Card, CardBody, CardHeader, Skeleton } from '@/components/ui/display';
import { Select } from '@/components/ui/field';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/utils';

const METHOD: Record<string, string> = { cash: 'Cash', pos: 'Card (POS)', bank_transfer: 'Bank transfer', paystack: 'Card (online)' };
const naira = (n: number) => formatNaira(n);

function autoGrouping(from: string, to: string): ReportGrouping {
  const days = daysInRange(from, to);
  return days <= 45 ? 'day' : days <= 200 ? 'week' : 'month';
}

function Attention({ icon: Icon, label, count, href, tone = 'neutral' }: { icon: typeof AlertTriangle; label: string; count: number; href: string; tone?: 'neutral' | 'warning' | 'danger' }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-5 py-3 hover:bg-subtle">
        <Icon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
        <span className="flex-1 text-sm text-ink">{label}</span>
        <Badge tone={count === 0 ? 'neutral' : tone}>{count}</Badge>
      </Link>
    </li>
  );
}

/** The reporting dashboard for head office and branch admins. */
export function AnalyticsDashboard({ footer }: { footer?: ReactNode }) {
  const [filter, setFilter, params] = useReportFilter();
  const groupBy = (params.get('groupBy') as ReportGrouping | null) ?? autoGrouping(filter.from, filter.to);
  const q = { from: filter.from, to: filter.to, branch: filter.branch || undefined };
  const opts = { placeholderData: keepPreviousData } as const;

  const overview = useQuery({ queryKey: ['analytics', 'overview', q], queryFn: () => api.get<AnalyticsOverviewDto>('/analytics/overview', q), ...opts });
  const series = useQuery({ queryKey: ['analytics', 'sales', q, groupBy], queryFn: () => api.get<SalesSeriesDto>('/analytics/sales', { ...q, groupBy }), ...opts });
  const top = useQuery({ queryKey: ['analytics', 'top', q], queryFn: () => api.get<TopProductsDto>('/analytics/top-products', { ...q, limit: 6 }), ...opts });
  const perf = useQuery({
    queryKey: ['analytics', 'branches', q],
    queryFn: () => api.get<BranchPerformanceReportDto>('/analytics/branches/performance', q),
    enabled: !filter.branch,
    ...opts,
  });
  const low = useQuery({ queryKey: ['analytics', 'low', filter.branch], queryFn: () => api.get<InventoryDto[]>('/analytics/low-stock', { branch: filter.branch || undefined, limit: 6 }) });
  const recent = useQuery({ queryKey: ['analytics', 'recent', filter.branch], queryFn: () => api.get<RecentTransactionsDto>('/analytics/recent-transactions', { branch: filter.branch || undefined, limit: 6 }) });

  const o = overview.data;
  const loading = overview.isLoading;
  const showBranches = !filter.branch && (perf.data?.branches.length ?? 0) > 1;

  return (
    <>
      <ReportFilters filter={filter} onChange={setFilter}>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-ink-muted">Chart by</span>
          <Select
            value={groupBy}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              next.set('groupBy', e.target.value);
              window.history.replaceState(null, '', `?${next.toString()}`);
            }}
            className="w-32"
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </Select>
        </label>
        <div className="ml-auto self-end">
          <ButtonLink href={`/admin/reports?${params.toString()}`} variant="secondary"><FileBarChart className="h-4 w-4" /> Detailed reports</ButtonLink>
        </div>
      </ReportFilters>

      {overview.error && <Alert className="mb-6">{errorMessage(overview.error)}</Alert>}

      <div className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-4 ${overview.isFetching && !loading ? 'opacity-60' : ''}`}>
        <StatTile label="Gross sales" loading={loading} value={o?.sales.grossSales.value} previous={o?.sales.grossSales.previous} format={naira} />
        {(loading || o?.financial) && (
          <StatTile label="Collected revenue" loading={loading} value={o?.financial?.collectedRevenue.value} previous={o?.financial?.collectedRevenue.previous} format={naira}
            hint={o?.financial?.refunds.value ? `After ${formatNaira(o.financial.refunds.value)} refunded` : undefined} />
        )}
        <StatTile label="Orders" loading={loading} value={o?.sales.orders.value} previous={o?.sales.orders.previous} />
        <StatTile label="Average order" loading={loading} value={o?.sales.averageOrderValue.value} previous={o?.sales.averageOrderValue.previous} format={naira} />
        <StatTile label="Units sold" loading={loading} value={o?.sales.unitsSold.value} previous={o?.sales.unitsSold.previous} hint="On completed orders" />
        {(loading || o?.financial) && (
          <StatTile label="Outstanding balance" loading={loading} value={o?.financial?.outstandingBalance} format={naira}
            hint={o?.financial ? `${o.financial.ordersWithBalance} open order${o.financial.ordersWithBalance === 1 ? '' : 's'} not fully paid` : undefined} />
        )}
        {(loading || o?.inventory.value != null) && (
          <StatTile label="Stock value at cost" loading={loading} value={o?.inventory.value} format={compactNaira}
            hint={o ? (o.inventory.linesWithoutCost ? `${o.inventory.linesWithoutCost} stock lines have no cost price` : `${o.inventory.units.toLocaleString('en-NG')} units on hand`) : undefined} />
        )}
        <StatTile label="New customers" loading={loading} value={o?.customers.new.value} previous={o?.customers.new.previous} hint={o ? `${o.customers.total.toLocaleString('en-NG')} customers in total` : undefined} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader
            title="Sales over time"
            description={series.data?.access.financial ? 'Gross sales (orders confirmed) and collected revenue (payments received, less refunds).' : 'Gross sales: orders confirmed in each period.'}
          />
          <CardBody>
            {series.error ? <Alert>{errorMessage(series.error)}</Alert> : series.isLoading ? <Skeleton className="h-64" /> : <SalesChart points={series.data?.points ?? []} unit={series.data?.groupBy ?? groupBy} loading={series.isFetching} />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Needs attention" description="Right now, whatever the period." />
          {loading || !o ? (
            <CardBody><Skeleton className="h-48" /></CardBody>
          ) : (
            <ul className="divide-y divide-line">
              <Attention icon={ClipboardList} label="Online orders waiting for confirmation" count={o.operations.pendingOrders} href="/admin/orders" tone="warning" />
              <Attention icon={ClipboardList} label="Orders being prepared or delivered" count={o.operations.ordersInProgress} href="/admin/orders" />
              <Attention icon={CalendarClock} label="Open reservations" count={o.operations.openReservations} href="/admin/reservations" />
              <Attention icon={CreditCard} label="Payments to check" count={o.operations.paymentsAwaitingReview} href="/admin/payments" tone="warning" />
              <Attention icon={Bike} label="Deliveries on the way" count={o.operations.activeDeliveries} href="/admin/deliveries" />
              <Attention icon={MessageSquare} label="Open enquiries" count={o.operations.openEnquiries} href="/admin/enquiries" />
              <Attention icon={AlertTriangle} label="Low stock lines" count={o.inventory.lowStock} href="/admin/inventory" tone="warning" />
              <Attention icon={PackageX} label="Out of stock lines" count={o.inventory.outOfStock} href="/admin/inventory" tone="danger" />
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {showBranches && (
          <Card>
            <CardHeader title="Branches compared" description="Gross sales in the period, with each branch's share." />
            <CardBody>
              <BarList
                empty="No sales in this period."
                items={(perf.data?.branches ?? []).map((b) => ({
                  key: b.branch.id,
                  label: <Link href={`/admin?${new URLSearchParams({ ...Object.fromEntries(params), branch: b.branch.id }).toString()}`} className="hover:underline">{b.branch.code} · {b.branch.name}</Link>,
                  value: b.grossSales,
                  display: formatNaira(b.grossSales),
                  sub: [
                    `${Math.round(b.shareOfSales * 100)}% of sales`,
                    `${b.orders} order${b.orders === 1 ? '' : 's'}`,
                    b.collectedRevenue !== null && `${formatNaira(b.collectedRevenue)} collected`,
                    b.outstandingBalance ? `${formatNaira(b.outstandingBalance)} owed` : null,
                    b.lowStock ? `${b.lowStock} stock alert${b.lowStock === 1 ? '' : 's'}` : null,
                  ].filter(Boolean).join(' · '),
                }))}
              />
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Best sellers" description="By sales value, on orders completed in the period." />
          <CardBody>
            {top.isLoading ? <Skeleton className="h-40" /> : (
              <BarList
                empty="No completed orders in this period yet."
                items={(top.data?.products ?? []).map((p) => ({
                  key: p.product.id,
                  label: p.product.name,
                  value: p.revenue,
                  display: formatNaira(p.revenue),
                  sub: `${p.unitsSold} unit${p.unitsSold === 1 ? '' : 's'} · ${p.orders} order${p.orders === 1 ? '' : 's'}`,
                }))}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Low stock" description="At or below the reorder level now." actions={<ButtonLink href="/admin/inventory" variant="ghost" size="sm">Stock levels <ArrowRight className="h-4 w-4" /></ButtonLink>} />
          {low.isLoading ? <CardBody><Skeleton className="h-32" /></CardBody> : !low.data?.length ? (
            <CardBody><p className="text-sm text-ink-muted">Nothing is running low.</p></CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {low.data.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{i.product.name}{i.variant && <span className="text-ink-muted"> · {i.variant.label}</span>}</p>
                    <p className="text-xs text-ink-muted">{i.branch.code} · {i.sku}</p>
                  </div>
                  <Badge tone={i.available <= 0 ? 'danger' : 'warning'}>{i.available <= 0 ? 'Out of stock' : `${i.available} left`}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Latest orders" actions={<ButtonLink href="/admin/orders" variant="ghost" size="sm">All orders <ArrowRight className="h-4 w-4" /></ButtonLink>} />
          {recent.isLoading ? <CardBody><Skeleton className="h-32" /></CardBody> : !recent.data?.orders.length ? (
            <CardBody><p className="text-sm text-ink-muted">No orders yet.</p></CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {recent.data.orders.map((r) => (
                <li key={r.id}>
                  <Link href={`/admin/orders/${r.id}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-subtle">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">{r.reference}</p>
                      <p className="truncate text-xs text-ink-muted">{r.customerName} · {r.branch.code} · {timeAgo(r.createdAt)}</p>
                    </div>
                    <span className="font-semibold tabular-nums">{formatNaira(r.total)}</span>
                    <OrderStatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {recent.data?.payments && (
          <Card>
            <CardHeader title="Latest payments received" actions={<ButtonLink href="/admin/payments" variant="ghost" size="sm">All payments <ArrowRight className="h-4 w-4" /></ButtonLink>} />
            {!recent.data.payments.length ? (
              <CardBody><p className="text-sm text-ink-muted">No payments yet.</p></CardBody>
            ) : (
              <ul className="divide-y divide-line">
                {recent.data.payments.map((p) => (
                  <li key={p.id}>
                    <Link href={`/admin/orders/${p.orderId}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-subtle">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-ink">{p.receiptNumber ?? p.reference}</p>
                        <p className="truncate text-xs text-ink-muted">{p.orderReference} · {METHOD[p.method] ?? p.method} · {formatDateTime(p.verifiedAt)}</p>
                      </div>
                      <span className="font-semibold tabular-nums">{formatNaira(p.amount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {o && (
        <p className="mt-6 text-xs text-ink-muted">
          {o.branch ? `${o.branch.name} only.` : `${o.branchCount} branch${o.branchCount === 1 ? '' : 'es'}.`} Period {o.range.from} to {o.range.to} (Lagos time), compared with {o.previousRange.from} to {o.previousRange.to}.
          Gross sales count orders once a branch confirms them; cancelled orders are left out.
        </p>
      )}
      {footer}
    </>
  );
}
