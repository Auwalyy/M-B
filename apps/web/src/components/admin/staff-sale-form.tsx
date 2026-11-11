'use client';

import { type CustomerLookupDto, type DeliveryZoneDto, type EnquiryDto, NIGERIAN_STATES, type OrderDto, type ReservationDto, formatNaira, normalizePhone } from '@mb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardBody, CardHeader } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BranchSelect, type Line, LineItems, toPayloadLines } from './commerce';

/**
 * One form for staff-created orders and reservations: walk-in, phone or WhatsApp customers.
 * Prices come from the server; the summary here is indicative.
 */
export function StaffSaleForm({ mode, enquiry }: { mode: 'order' | 'reservation'; enquiry?: EnquiryDto | null }) {
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const key = useRef(crypto.randomUUID());
  const [branch, setBranch] = useState(enquiry?.branch.id ?? (user?.scope === 'branch' ? user.branches[0]?.id ?? '' : ''));
  const [channel, setChannel] = useState<'in_store' | 'phone' | 'whatsapp'>(enquiry ? (enquiry.channel === 'walk_in' ? 'in_store' : enquiry.channel === 'web_form' ? 'phone' : enquiry.channel) : 'in_store');
  const [phone, setPhone] = useState(enquiry?.contact.phone ?? '');
  const [match, setMatch] = useState<CustomerLookupDto | null | undefined>(undefined);
  const [contact, setContact] = useState({ fullName: enquiry?.contact.name ?? '', email: enquiry?.contact.email ?? '' });
  const [lines, setLines] = useState<Line[]>([]);
  const [fulfilment, setFulfilment] = useState<'pickup' | 'delivery'>('pickup');
  const [zone, setZone] = useState('');
  const [address, setAddress] = useState({ line1: '', area: '', city: '', state: 'Kano', landmark: '' });
  const [payment, setPayment] = useState<'cash' | 'pos' | 'bank_transfer' | 'pay_on_pickup' | 'pay_on_delivery'>('cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const zones = useQuery({ queryKey: ['zones', branch], queryFn: () => api.get<DeliveryZoneDto[]>('/delivery-zones', { branch }), enabled: Boolean(branch) && mode === 'order' });

  useEffect(() => setMatch(undefined), [phone]);
  useEffect(() => { if (fulfilment === 'delivery' && payment === 'pay_on_pickup') setPayment('pay_on_delivery'); }, [fulfilment, payment]);

  const lookup = async () => {
    const p = normalizePhone(phone);
    if (!p) return setError('Enter a valid phone number.');
    setError(null);
    try {
      const m = await api.get<CustomerLookupDto | null>('/customers/lookup', { phone: p });
      setMatch(m);
      if (m) setContact((c) => ({ ...c, fullName: m.fullName }));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const estimate = lines.reduce((n, l) => {
    const v = l.variant;
    const unit = v ? (v.discountPrice ?? v.price ?? l.product.discountPrice ?? l.product.price) : (l.product.discountPrice ?? l.product.price);
    return n + unit * l.quantity;
  }, 0);

  const submit = async () => {
    setError(null);
    if (!branch) return setError('Choose the branch.');
    if (!lines.length) return setError('Add at least one product.');
    if (!match && !contact.fullName.trim()) return setError('Enter the customer’s name.');
    const p = normalizePhone(phone);
    if (!p) return setError('Enter the customer’s phone number.');
    const customerPart = match ? { customer: match.id } : { contact: { fullName: contact.fullName, phone: p, email: contact.email.trim() || undefined } };
    setBusy(true);
    try {
      if (mode === 'order') {
        const o = await api.post<OrderDto>('/orders', {
          branch, channel, ...customerPart, items: toPayloadLines(lines), fulfilment, paymentMethod: payment, note: note || undefined, enquiry: enquiry?.id, idempotencyKey: key.current,
          ...(fulfilment === 'delivery' ? { deliveryZone: zone || undefined, deliveryAddress: { line1: address.line1, area: address.area || undefined, city: address.city, state: address.state, landmark: address.landmark || undefined } } : {}),
        });
        await qc.invalidateQueries({ queryKey: ['orders'] });
        toast.success(`Order ${o.reference} created`);
        router.push(`/admin/orders/${o.id}`);
      } else {
        const r = await api.post<ReservationDto>('/reservations/staff', {
          branch, channel, contact: match ? { fullName: match.fullName, phone: p } : { fullName: contact.fullName, phone: p, email: contact.email.trim() || undefined },
          items: toPayloadLines(lines), note: note || undefined, enquiry: enquiry?.id,
        });
        await qc.invalidateQueries({ queryKey: ['reservations'] });
        toast.success(`Reservation ${r.reference} created`);
        router.push(`/admin/reservations/${r.id}`);
      }
    } catch (err) {
      setError(err instanceof ApiError && err.details && typeof err.details === 'object' && 'problems' in err.details ? (err.details as { problems: string[] }).problems.join(' ') : errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      {enquiry && <Alert kind="info" title={`From enquiry ${enquiry.reference}`}>“{enquiry.subject}”. The enquiry is closed as converted when you save.</Alert>}
      <Card>
        <CardHeader title="Customer" />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Branch" required>{() => <BranchSelect value={branch} onChange={setBranch} />}</Field>
            <Field label="How did they reach us?">
              {(p) => <Select {...p} value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} className="w-44"><option value="in_store">In the branch</option><option value="phone">Phone call</option><option value="whatsapp">WhatsApp</option></Select>}
            </Field>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Phone number" required className="min-w-56 flex-1">{(p) => <Input {...p} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => phone && match === undefined && void lookup()} placeholder="0803 123 4567" />}</Field>
            <Button variant="secondary" onClick={lookup}>Find customer</Button>
          </div>
          {match && <Alert kind="success" title={`Existing customer: ${match.fullName}`}><UserCheck className="mr-1 inline h-4 w-4" />The order is added to their history.</Alert>}
          {match === null && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" required>{(p) => <Input {...p} value={contact.fullName} onChange={(e) => setContact({ ...contact, fullName: e.target.value })} />}</Field>
              <Field label="Email (optional)">{(p) => <Input {...p} type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />}</Field>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Products" description="Availability shown is at the chosen branch." />
        <CardBody><LineItems lines={lines} onChange={setLines} mode="quantity" branch={branch} emptyHint="Search above to add products." /></CardBody>
      </Card>

      {mode === 'order' && (
        <Card>
          <CardHeader title="Collection and payment" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer receives it by">{(p) => <Select {...p} value={fulfilment} onChange={(e) => setFulfilment(e.target.value as typeof fulfilment)}><option value="pickup">Collecting at the branch</option><option value="delivery">Delivery</option></Select>}</Field>
            <Field label="Payment">
              {(p) => (
                <Select {...p} value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)}>
                  <option value="cash">Cash now</option><option value="pos">Card (POS) now</option><option value="bank_transfer">Bank transfer</option>
                  {fulfilment === 'pickup' ? <option value="pay_on_pickup">Pay when collecting</option> : <option value="pay_on_delivery">Pay on delivery</option>}
                </Select>
              )}
            </Field>
            {fulfilment === 'delivery' && (
              <>
                <Field label="Delivery area" required className="sm:col-span-2">{(p) => <Select {...p} value={zone} onChange={(e) => setZone(e.target.value)}><option value="">Choose an area</option>{zones.data?.map((z) => <option key={z.id} value={z.id}>{z.name} · {formatNaira(z.fee)}</option>)}</Select>}</Field>
                <Field label="Address" required className="sm:col-span-2">{(p) => <Input {...p} value={address.line1} onChange={(e) => setAddress({ ...address, line1: e.target.value })} />}</Field>
                <Field label="City" required>{(p) => <Input {...p} value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} />}</Field>
                <Field label="State">{(p) => <Select {...p} value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value })}>{NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>}</Field>
              </>
            )}
            {['cash', 'pos'].includes(payment) && <p className="text-xs text-ink-muted sm:col-span-2">After saving, use “Record payment” on the order to log the money received.</p>}
          </CardBody>
        </Card>
      )}

      <Field label="Note">{(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <div className="flex items-center justify-end gap-4">
        {lines.length > 0 && <p className="text-sm text-ink-muted">About <strong className="text-ink">{formatNaira(estimate)}</strong> before delivery and promotions</p>}
        <Button size="lg" loading={busy} onClick={submit}>{mode === 'order' ? 'Create order' : 'Reserve items'}</Button>
      </div>
    </div>
  );
}
