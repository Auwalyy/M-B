'use client';

import { type ReservationDto, formatNaira } from '@mb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ReservationStatusBadge } from '@/components/reservation-status';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/display';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

/** The customer's reservations. Hidden when there are none. */
export function MyReservationsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['my-reservations'], queryFn: () => api.get<ReservationDto[]>('/reservations/mine') });
  if (!list.data?.length) return null;
  return (
    <Card>
      <CardHeader title="My reservations" />
      <ul className="divide-y divide-line">
        {list.data.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{r.reference} · {r.branch.name}</p>
              <p className="text-xs text-ink-muted">
                {r.items.map((i) => `${i.quantity}× ${i.product.name}`).join(', ')} · {formatNaira(r.total)}
                {r.expiresAt && ['pending', 'confirmed'].includes(r.status) && ` · held until ${formatDateTime(r.expiresAt)}`}
              </p>
            </div>
            <ReservationStatusBadge status={r.status} />
            {r.allowedActions.includes('cancel') && (
              <Button size="sm" variant="ghost" onClick={async () => {
                try {
                  await api.post(`/reservations/${r.id}/cancel`, {});
                  void qc.invalidateQueries({ queryKey: ['my-reservations'] });
                  toast.success('Reservation cancelled');
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}>Cancel</Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
