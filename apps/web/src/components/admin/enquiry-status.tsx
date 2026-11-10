import type { EnquiryChannel, EnquiryStatus } from '@mb/shared';
import { Badge, type Tone } from '@/components/ui/display';

export const ENQUIRY_STATUS: Record<EnquiryStatus, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'danger' },
  in_progress: { label: 'In progress', tone: 'warning' },
  responded: { label: 'Responded', tone: 'info' },
  converted: { label: 'Became a sale', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
};

export const CHANNEL: Record<EnquiryChannel, string> = { web_form: 'Website', whatsapp: 'WhatsApp', phone: 'Phone', walk_in: 'Walk-in' };

export function EnquiryStatusBadge({ status }: { status: EnquiryStatus }) {
  const s = ENQUIRY_STATUS[status];
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}
