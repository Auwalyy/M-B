import type { TransferStatus } from '@mb/shared';
import { Badge, type Tone } from '@/components/ui/display';

export const TRANSFER_STATUS: Record<TransferStatus, { label: string; tone: Tone }> = {
  requested: { label: 'Awaiting approval', tone: 'warning' },
  approved: { label: 'Approved · ready to send', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  in_transit: { label: 'In transit', tone: 'accent' },
  received: { label: 'Received', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  const s = TRANSFER_STATUS[status];
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}
