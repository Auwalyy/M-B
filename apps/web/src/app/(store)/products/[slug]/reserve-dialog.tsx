'use client';

import { type PublicProductDto, type ReservationDto, createReservationSchema, formatPhone } from '@mb/shared';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/field';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

export function ReserveDialog({ product, variantId, quantity, branch, onClose }: { product: PublicProductDto; variantId: string | null; quantity: number; branch: { id: string; name: string }; onClose: () => void }) {
  const { user } = useAuth();
  const [contact, setContact] = useState({ fullName: user?.fullName ?? '', phone: user?.phone ? formatPhone(user.phone) : '', email: user?.email ?? '' });
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ReservationDto | null>(null);
  const variant = product.variants.find((v) => v.id === variantId);

  const submit = async () => {
    setError(null);
    const body = { branch: branch.id, items: [{ product: product.id, variantId, quantity }], contact: { fullName: contact.fullName, phone: contact.phone, email: contact.email.trim() || undefined }, note: note || undefined };
    const parsed = createReservationSchema.safeParse(body);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const i of parsed.error.issues) e[i.path.join('.')] ??= i.message;
      return setErrors(e);
    }
    setErrors({});
    setBusy(true);
    try {
      setDone(await api.post<ReservationDto>('/reservations', body));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={done ? 'Reservation received' : `Reserve at ${branch.name}`}
      description={done ? undefined : `${quantity} × ${product.name}${variant ? ` (${variant.label})` : ''}. We hold it for you; you pay when you collect.`}
      footer={done ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Reserve</Button></>}
    >
      {done ? (
        <div className="space-y-3 text-sm">
          <CheckCircle2 className="h-8 w-8 text-success-700" aria-hidden />
          <p>Your reservation number is <strong>{done.reference}</strong>. The items are held until <strong>{done.expiresAt ? formatDateTime(done.expiresAt) : 'the branch confirms'}</strong>.</p>
          <p className="text-ink-muted">{branch.name} will confirm shortly. We will let you know by {contact.email ? 'email' : 'phone'}.</p>
          <ButtonLink href={user ? '/account' : `/track?reference=${done.reference}&phone=${encodeURIComponent(contact.phone)}`} variant="secondary" size="sm">Follow your reservation</ButtonLink>
        </div>
      ) : (
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Full name" error={errors['contact.fullName']} required>{(p) => <Input {...p} autoComplete="name" value={contact.fullName} onChange={(e) => setContact({ ...contact, fullName: e.target.value })} />}</Field>
          <Field label="Phone number" error={errors['contact.phone']} required>{(p) => <Input {...p} type="tel" autoComplete="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />}</Field>
          <Field label="Email (optional)" error={errors['contact.email']}>{(p) => <Input {...p} type="email" autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />}</Field>
          <Field label="Note for the branch (optional)">{(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="When you plan to come" />}</Field>
        </div>
      )}
    </Dialog>
  );
}
