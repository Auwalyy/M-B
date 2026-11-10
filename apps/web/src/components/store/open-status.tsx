'use client';

import type { OpeningHoursDto } from '@mb/shared';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/display';

/** Current weekday (0 = Sunday) and HH:MM in Nigeria, whatever the visitor's timezone. */
export function lagosNow(date = new Date()): { day: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, time: `${get('hour').replace('24', '00')}:${get('minute')}` };
}

export function isOpen(hours: OpeningHoursDto[], date = new Date()): boolean {
  const now = lagosNow(date);
  const today = hours.find((h) => h.day === now.day);
  return Boolean(today && !today.closed && now.time >= today.open && now.time < today.close);
}

/** Rendered on the client so the status reflects the visitor's moment, not the server's cache. */
export function OpenStatus({ hours }: { hours: OpeningHoursDto[] }) {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    const tick = () => setOpen(isOpen(hours));
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [hours]);
  if (open === null) return null;
  return open ? <Badge tone="success" dot>Open now</Badge> : <Badge tone="neutral" dot>Closed</Badge>;
}
