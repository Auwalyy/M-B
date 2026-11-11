import { type PublicBranchDto, WEEKDAYS, formatPhone, toWhatsAppNumber } from '@mb/shared';
import { MapPin, MessageCircle, Navigation, Phone } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';
import { Badge } from '@/components/ui/display';
import { OpenStatus } from './open-status';
import { WhatsAppLink } from './whatsapp-link';

export function whatsappLink(e164: string, message: string): string {
  return `https://wa.me/${toWhatsAppNumber(e164)}?text=${encodeURIComponent(message)}`;
}

export function directionsLink(b: PublicBranchDto): string {
  const q = b.coordinates ? `${b.coordinates.lat},${b.coordinates.lng}` : `${b.address}, ${b.area ?? ''} ${b.city}, ${b.state}, Nigeria`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Collapses identical consecutive days: "Mon–Sat 08:00–18:00 · Sun Closed". */
export function summariseHours(hours: PublicBranchDto['openingHours']): string[] {
  const byDay = [1, 2, 3, 4, 5, 6, 0].map((d) => hours.find((h) => h.day === d) ?? { day: d, open: '', close: '', closed: true });
  const label = (h: (typeof byDay)[number]) => (h.closed ? 'Closed' : `${h.open}–${h.close}`);
  const out: string[] = [];
  let start = byDay[0]!;
  let prev = byDay[0]!;
  for (const h of [...byDay.slice(1), null]) {
    if (h && label(h) === label(prev)) {
      prev = h;
      continue;
    }
    const s = WEEKDAYS[start.day]!.slice(0, 3);
    const e = WEEKDAYS[prev.day]!.slice(0, 3);
    out.push(`${s === e ? s : `${s}–${e}`} ${label(prev)}`);
    if (h) start = prev = h;
  }
  return out;
}

export function BranchCard({ branch, companyName = 'Mudassir & Brothers' }: { branch: PublicBranchDto; companyName?: string }) {
  const message = `Hello ${companyName}, I would like to make an enquiry at your ${branch.name} branch.`;
  return (
    <article className="flex h-full flex-col rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-accent-600 uppercase">{branch.state === 'FCT' ? 'Abuja' : branch.state}</p>
          <h3 className="mt-0.5 text-lg font-bold text-ink">{branch.name}</h3>
        </div>
        <OpenStatus hours={branch.openingHours} />
      </div>

      <p className="mt-3 flex gap-2 text-sm text-ink-muted">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
        <span>
          {branch.address}
          {branch.area ? `, ${branch.area}` : ''}, {branch.city}
          {branch.landmark && <span className="block text-ink-faint">{branch.landmark}</span>}
        </span>
      </p>

      <ul className="mt-3 space-y-0.5 text-sm text-ink-muted">
        {summariseHours(branch.openingHours).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {branch.services.pickup && <Badge tone="brand">Pickup</Badge>}
        {branch.services.delivery && <Badge tone="brand">Delivery</Badge>}
        {branch.services.reservations && <Badge tone="brand">Reservations</Badge>}
      </div>

      <div className="mt-auto flex flex-wrap gap-2 pt-5">
        <WhatsAppLink context="branch" branch={branch.id} href={whatsappLink(branch.whatsapp, message)} className={buttonClasses('primary', 'sm')}>
          <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
        </WhatsAppLink>
        <a href={`tel:${branch.phone}`} className={buttonClasses('secondary', 'sm')} aria-label={`Call ${branch.name} on ${formatPhone(branch.phone)}`}>
          <Phone className="h-4 w-4" aria-hidden /> Call
        </a>
        <a href={directionsLink(branch)} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'sm')}>
          <Navigation className="h-4 w-4" aria-hidden /> Directions
        </a>
      </div>
    </article>
  );
}
