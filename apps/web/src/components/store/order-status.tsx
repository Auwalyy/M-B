import type { FulfilmentMethod, OrderStatus } from '@mb/shared';
import { Check } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/display';
import { cn, formatDateTime } from '@/lib/utils';

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone; customer: string }> = {
  pending: { label: 'Placed', tone: 'warning', customer: 'We have your order. The branch will confirm it shortly.' },
  confirmed: { label: 'Confirmed', tone: 'info', customer: 'The branch has confirmed your order.' },
  processing: { label: 'Being prepared', tone: 'info', customer: 'Your items are being prepared.' },
  ready_for_pickup: { label: 'Ready for pickup', tone: 'success', customer: 'Your order is ready. Bring your order number to the branch.' },
  out_for_delivery: { label: 'Out for delivery', tone: 'accent', customer: 'Your order is on its way.' },
  completed: { label: 'Completed', tone: 'success', customer: 'Thank you for shopping with us.' },
  cancelled: { label: 'Cancelled', tone: 'neutral', customer: 'This order was cancelled.' },
  refunded: { label: 'Refunded', tone: 'neutral', customer: 'This order was refunded.' },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_STATUS[status].tone} dot>{ORDER_STATUS[status].label}</Badge>;
}

/** Progress steps for the customer; the final step depends on pickup or delivery. */
export function OrderProgress({ status, fulfilment, history }: { status: OrderStatus; fulfilment: FulfilmentMethod; history: { status: OrderStatus; at: string }[] }) {
  if (status === 'cancelled' || status === 'refunded') return <p className="text-sm text-ink-muted">{ORDER_STATUS[status].customer}</p>;
  const steps: OrderStatus[] = ['pending', 'confirmed', 'processing', fulfilment === 'pickup' ? 'ready_for_pickup' : 'out_for_delivery', 'completed'];
  const reached = steps.indexOf(status);
  const when = (s: OrderStatus) => history.find((h) => h.status === s)?.at;
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const done = i <= reached;
        return (
          <li key={s} className="flex items-start gap-3">
            <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2', done ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface')} aria-hidden>
              {done && <Check className="h-3.5 w-3.5" />}
            </span>
            <div>
              <p className={cn('text-sm font-semibold', !done && 'text-ink-faint')}>{ORDER_STATUS[s].label}{i === reached && <span className="sr-only"> (current)</span>}</p>
              {when(s) && <p className="text-xs text-ink-muted">{formatDateTime(when(s))}</p>}
              {i === reached && <p className="text-xs text-ink-muted">{ORDER_STATUS[s].customer}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
