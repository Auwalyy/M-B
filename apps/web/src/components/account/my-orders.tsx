'use client';

import { type OrderDto, formatNaira } from '@mb/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { OrderStatusBadge } from '@/components/store/order-status';
import { ButtonLink } from '@/components/ui/button';
import { Alert, Card, CardHeader, EmptyState, Skeleton } from '@/components/ui/display';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/utils';

export function MyOrdersCard() {
  const orders = useQuery({ queryKey: ['my-orders'], queryFn: () => api.page<OrderDto>('/orders/mine', { limit: 20 }) });
  return (
    <Card>
      <CardHeader title="My orders" />
      {orders.isLoading && <div className="space-y-2 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
      {orders.error && <div className="p-5"><Alert>{errorMessage(orders.error)}</Alert></div>}
      {orders.data?.data.length === 0 && <EmptyState icon={ShoppingBag} title="No orders yet" action={<ButtonLink href="/shop" size="sm">Start shopping</ButtonLink>} />}
      <ul className="divide-y divide-line">
        {orders.data?.data.map((o) => (
          <li key={o.id}>
            <Link href={`/account/orders/${o.reference}`} className="flex items-center gap-3 px-5 py-3 hover:bg-subtle">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{o.reference}</p>
                <p className="text-xs text-ink-muted">{formatDate(o.createdAt)} · {o.items.reduce((n, i) => n + i.quantity, 0)} items · {o.branch.name}</p>
              </div>
              <span className="font-semibold tabular-nums">{formatNaira(o.total)}</span>
              <OrderStatusBadge status={o.status} />
              <ChevronRight className="h-4 w-4 text-ink-faint" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
