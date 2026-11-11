import type { ReservationStatus } from '@mb/shared';
import { Badge, type Tone } from '@/components/ui/display';

export const RESERVATION_STATUS: Record<ReservationStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Awaiting confirmation', tone: 'warning' },
  confirmed: { label: 'Confirmed · held', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  converted: { label: 'Became an order', tone: 'brand' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function ReservationStatusBadge({ status }: { status: ReservationStatus }) {
  return <Badge tone={RESERVATION_STATUS[status].tone} dot>{RESERVATION_STATUS[status].label}</Badge>;
}
