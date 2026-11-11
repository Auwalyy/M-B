'use client';

import { type OrderDto, type ReservationDto, formatNaira, formatPhone, toWhatsAppNumber } from '@mb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, MessageCircle, Phone, ShoppingCart, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Thumb } from '@/components/admin/commerce';
import { RESERVATION_STATUS, ReservationStatusBadge } from '@/components/reservation-status';
import { Button, buttonClasses } from '@/components/ui/button';
import { Alert, Card, CardBody, CardHeader, PageHeader, Skeleton } from '@/components/ui/display';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

export default function ReservationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const r = useQuery({ queryKey: ['reservation', id], queryFn: () => api.get<ReservationDto>(`/reservations/${id}`) });
  const [dialog, setDialog] = useState<'reject' | 'cancel' | 'convert' | null>(null);
  const [text, setText] = useState('');
  const [payment, setPayment] = useState('pay_on_pickup');
  const [busy, setBusy] = useState(false);

  const back = <Link href="/admin/reservations" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Reservations</Link>;
  if (r.isLoading) return <Skeleton className="h-96" />;
  if (r.error || !r.data) return <><PageHeader title="Reservation" back={back} /><Alert>{r.error ? errorMessage(r.error) : 'Not found'}</Alert></>;
  const x = r.data;

  const act = async (action: 'confirm' | 'reject' | 'cancel' | 'convert') => {
    setBusy(true);
    try {
      if (action === 'convert') {
        const o = await api.post<OrderDto>(`/reservations/${id}/convert`, { paymentMethod: payment, fulfilment: 'pickup' });
        toast.success(`Order ${o.reference} created`);
        router.push(`/admin/orders/${o.id}`);
        return;
      }
      const body = action === 'reject' ? { reason: text } : { note: text || undefined };
      qc.setQueryData(['reservation', id], await api.post<ReservationDto>(`/reservations/${id}/${action}`, body));
      void qc.invalidateQueries({ queryKey: ['reservations'] });
      toast.success(action === 'confirm' ? 'Confirmed. The customer has been told.' : action === 'reject' ? 'Rejected. Stock released.' : 'Cancelled. Stock released.');
      setDialog(null);
      setText('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={x.reference}
        back={back}
        description={<span className="inline-flex flex-wrap items-center gap-2"><ReservationStatusBadge status={x.status} /> {x.branch.name} · {formatDateTime(x.createdAt)}</span>}
        actions={
          <>
            <a href={`tel:${x.customer.phone}`} className={buttonClasses('secondary')}><Phone className="h-4 w-4" /> Call</a>
            <a href={`https://wa.me/${toWhatsAppNumber(x.customer.phone)}?text=${encodeURIComponent(`Hello ${x.customer.fullName.split(' ')[0]}, this is ${x.branch.name} about your reservation ${x.reference}. `)}`} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary')}><MessageCircle className="h-4 w-4" /> WhatsApp</a>
            {x.allowedActions.includes('confirm') && <Button loading={busy} onClick={() => act('confirm')}><Check className="h-4 w-4" /> Confirm</Button>}
            {x.allowedActions.includes('reject') && <Button variant="danger-outline" onClick={() => setDialog('reject')}><X className="h-4 w-4" /> Reject</Button>}
            {x.allowedActions.includes('convert') && <Button onClick={() => setDialog('convert')}><ShoppingCart className="h-4 w-4" /> Customer is here: create order</Button>}
            {x.allowedActions.includes('cancel') && <Button variant="ghost" onClick={() => setDialog('cancel')}>Cancel</Button>}
          </>
        }
      />
      {x.expiresAt && ['pending', 'confirmed'].includes(x.status) && (
        <Alert kind={x.status === 'pending' ? 'warning' : 'info'} className="mb-6">
          {x.status === 'pending' ? 'Confirm or reject before ' : 'Items are held until '}<strong>{formatDateTime(x.expiresAt)}</strong>. After that they are released automatically.
        </Alert>
      )}
      {x.convertedOrder && <Alert kind="success" className="mb-6">Became order <Link href={`/admin/orders/${x.convertedOrder.id}`} className="font-semibold underline">{x.convertedOrder.reference}</Link>.</Alert>}
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card>
          <CardHeader title="Reserved items" description={`${formatNaira(x.total)} at reserved prices`} />
          <ul className="divide-y divide-line">
            {x.items.map((i) => (
              <li key={`${i.product.id}${i.variant?.id ?? ''}`} className="flex items-center gap-3 px-5 py-3">
                <Thumb url={i.product.image} alt="" />
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{i.product.name}{i.variant && <span className="text-ink-muted"> · {i.variant.label}</span>}</p><p className="text-xs text-ink-muted">{i.sku} · {i.quantity} × {formatNaira(i.unitPrice)}</p></div>
              </li>
            ))}
          </ul>
          {x.note && <CardBody className="border-t border-line text-sm text-ink-muted">“{x.note}”</CardBody>}
        </Card>
        <aside className="space-y-6">
          <Card>
            <CardHeader title="Customer" />
            <CardBody className="text-sm"><p className="font-medium">{x.customer.fullName}</p><p className="text-ink-muted">{formatPhone(x.customer.phone)}</p>{x.customer.email && <p className="text-ink-muted">{x.customer.email}</p>}</CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <CardBody><ol className="space-y-2 text-sm">{x.history.map((h, i) => <li key={i}><strong>{RESERVATION_STATUS[h.status].label}</strong> <span className="text-ink-muted">· {formatDateTime(h.at)}</span>{h.note && <p className="text-xs text-ink-faint">{h.note}</p>}</li>)}</ol></CardBody>
          </Card>
        </aside>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)} size="sm"
        title={dialog === 'reject' ? 'Reject this reservation?' : dialog === 'cancel' ? 'Cancel this reservation?' : 'Create the order'}
        description={dialog === 'convert' ? 'The held items move to a new order at the reserved prices. Record the payment on the order.' : 'The items are released for other customers. The customer is told.'}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Back</Button><Button variant={dialog === 'convert' ? 'primary' : 'danger'} loading={busy} disabled={dialog === 'reject' && !text.trim()} onClick={() => act(dialog!)}>{dialog === 'convert' ? 'Create order' : dialog === 'reject' ? 'Reject' : 'Cancel reservation'}</Button></>}>
        {dialog === 'convert' ? (
          <Field label="Payment">{(p) => <Select {...p} value={payment} onChange={(e) => setPayment(e.target.value)}><option value="pay_on_pickup">Paying now at the branch</option><option value="cash">Cash</option><option value="pos">Card (POS)</option><option value="bank_transfer">Bank transfer</option></Select>}</Field>
        ) : (
          <Field label={dialog === 'reject' ? 'Reason (shown to the customer)' : 'Note (optional)'} required={dialog === 'reject'}>{(p) => <Textarea {...p} rows={2} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
        )}
      </Dialog>
    </div>
  );
}
