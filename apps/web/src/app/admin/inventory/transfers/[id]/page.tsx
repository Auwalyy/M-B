'use client';

import type { TransferAction, TransferDto } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, PackageCheck, Send, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Thumb } from '@/components/admin/commerce';
import { TRANSFER_STATUS, TransferStatusBadge } from '@/components/admin/transfer-status';
import { Button, type ButtonVariant } from '@/components/ui/button';
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, Skeleton } from '@/components/ui/display';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { keys2, useTransfer } from '@/lib/queries';
import { formatDateTime } from '@/lib/utils';

const ACTIONS: Record<TransferAction, { label: string; icon: typeof Check; variant: ButtonVariant; confirm: (t: TransferDto) => string }> = {
  approve: { label: 'Approve', icon: Check, variant: 'primary', confirm: (t) => `${t.fromBranch.name} will be asked to send the items.` },
  reject: { label: 'Reject', icon: X, variant: 'danger-outline', confirm: () => 'No stock will move.' },
  dispatch: { label: 'Mark as sent', icon: Send, variant: 'primary', confirm: (t) => `The units leave ${t.fromBranch.name}'s stock now and stay in transit until ${t.toBranch.name} confirms arrival.` },
  receive: { label: 'Confirm received', icon: PackageCheck, variant: 'primary', confirm: (t) => `The units are added to ${t.toBranch.name}'s stock. Only confirm after counting them.` },
  cancel: { label: 'Cancel transfer', icon: X, variant: 'danger-outline', confirm: () => 'No stock will move.' },
};

export default function TransferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const transfer = useTransfer(id);
  const [pending, setPending] = useState<TransferAction | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const back = <Link href="/admin/inventory/transfers" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Transfers</Link>;
  if (transfer.isLoading) return <Skeleton className="h-96" />;
  if (transfer.error || !transfer.data) return <><PageHeader title="Transfer" back={back} /><Alert>{transfer.error ? errorMessage(transfer.error) : 'Not found'}</Alert></>;
  const t = transfer.data;

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const updated = await api.post<TransferDto>(`/inventory/transfers/${id}/${pending}`, { note: note || undefined });
      qc.setQueryData(keys2.transfer(id), updated);
      await Promise.all(['transfers', 'inventory', 'movements'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast.success(TRANSFER_STATUS[updated.status].label);
      setPending(null);
      setNote('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={t.reference}
        back={back}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge>{t.fromBranch.code}</Badge><ArrowRight className="h-3.5 w-3.5" /><Badge>{t.toBranch.code}</Badge>
            <TransferStatusBadge status={t.status} />
          </span>
        }
        actions={t.allowedActions.map((a) => {
          const A = ACTIONS[a];
          return <Button key={a} variant={A.variant} onClick={() => setPending(a)}><A.icon className="h-4 w-4" /> {A.label}</Button>;
        })}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card>
          <CardHeader title="Items" description={`${t.items.reduce((n, i) => n + i.quantity, 0)} units`} />
          <ul className="divide-y divide-line">
            {t.items.map((i) => (
              <li key={`${i.product.id}${i.variant?.id ?? ''}`} className="flex items-center gap-3 px-5 py-3">
                <Thumb url={i.product.image} alt="" size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{i.product.name}{i.variant && <span className="text-ink-muted"> · {i.variant.label}</span>}</p>
                  <p className="text-xs text-ink-muted">{i.sku}</p>
                </div>
                <span className="text-lg font-semibold tabular-nums">{i.quantity}</span>
              </li>
            ))}
          </ul>
          {t.note && <CardBody className="border-t border-line text-sm text-ink-muted">“{t.note}”</CardBody>}
        </Card>
        <Card>
          <CardHeader title="Progress" />
          <CardBody>
            <ol className="space-y-4">
              {t.history.map((h, i) => (
                <li key={i} className="relative pl-6">
                  <span className="absolute top-1.5 left-0 h-2.5 w-2.5 rounded-full bg-brand-600" aria-hidden />
                  <p className="text-sm font-semibold">{TRANSFER_STATUS[h.status].label}</p>
                  <p className="text-xs text-ink-muted">{h.by?.fullName ?? 'System'} · {formatDateTime(h.at)}</p>
                  {h.note && <p className="mt-0.5 text-xs text-ink-faint">“{h.note}”</p>}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>
      <Dialog
        open={Boolean(pending)}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? `${ACTIONS[pending].label}?` : ''}
        description={pending ? ACTIONS[pending].confirm(t) : undefined}
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setPending(null)}>Back</Button><Button variant={pending === 'reject' || pending === 'cancel' ? 'danger' : 'primary'} loading={busy} onClick={run}>{pending ? ACTIONS[pending].label : ''}</Button></>}
      >
        <Field label="Note (optional)">{(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </Dialog>
    </div>
  );
}
