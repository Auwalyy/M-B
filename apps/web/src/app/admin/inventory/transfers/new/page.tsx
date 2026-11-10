'use client';

import type { TransferDto } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BranchSelect, type Line, LineItems, toPayloadLines } from '@/components/admin/commerce';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert, Card, CardBody, CardHeader, PageHeader } from '@/components/ui/display';
import { Field, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function NewTransferPage() {
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const own = user?.scope === 'branch' ? user.branches[0]?.id ?? '' : '';
  const [from, setFrom] = useState(own);
  const [to, setTo] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!from || !to) return setError('Choose both branches.');
    if (from === to) return setError('Choose two different branches.');
    if (!lines.length) return setError('Add at least one product.');
    if (lines.some((l) => l.quantity < 1)) return setError('Quantities must be at least 1.');
    setBusy(true);
    try {
      const t = await api.post<TransferDto>('/inventory/transfers', { fromBranch: from, toBranch: to, items: toPayloadLines(lines), note: note || undefined });
      await qc.invalidateQueries({ queryKey: ['transfers'] });
      toast.success(t.status === 'approved' ? `${t.reference} created and approved` : `${t.reference} sent for approval`);
      router.push(`/admin/inventory/transfers/${t.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Request a transfer"
        description="Head office approves the request. The sending branch then dispatches it, and the receiving branch confirms arrival."
        back={<Link href="/admin/inventory/transfers" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Transfers</Link>}
      />
      <div className="space-y-6">
        {error && <Alert>{error}</Alert>}
        <Card>
          <CardHeader title="Route" />
          <CardBody className="flex flex-wrap items-end gap-3">
            <Field label="From" required>{() => <BranchSelect value={from} onChange={setFrom} />}</Field>
            <ArrowRight className="mb-3 h-5 w-5 text-ink-faint" aria-hidden />
            <Field label="To" required>{() => <BranchSelect value={to} onChange={setTo} only={(id) => id !== from} />}</Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Products" description="Availability shown is at the sending branch." />
          <CardBody><LineItems lines={lines} onChange={setLines} mode="quantity" branch={from} emptyHint="Search above to add products." /></CardBody>
        </Card>
        <Field label="Note for head office">{(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is this transfer needed?" />}</Field>
        <div className="flex justify-end gap-3">
          <ButtonLink href="/admin/inventory/transfers" variant="secondary">Cancel</ButtonLink>
          <Button loading={busy} onClick={submit}>Submit request</Button>
        </div>
      </div>
    </div>
  );
}
