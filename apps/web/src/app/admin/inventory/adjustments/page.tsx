'use client';

import { type AdjustmentDto, PERMISSIONS } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardCheck, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { BranchSelect } from '@/components/admin/commerce';
import { StockDialog } from '@/components/admin/stock-dialog';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAdjustments } from '@/lib/queries';
import { cn, formatDateTime } from '@/lib/utils';

const STATUS = { pending: { tone: 'warning', label: 'Awaiting approval' }, applied: { tone: 'success', label: 'Applied' }, rejected: { tone: 'neutral', label: 'Rejected' } } as const;

export default function AdjustmentsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const [branch, setBranch] = useState('');
  const [creating, setCreating] = useState(false);
  const [review, setReview] = useState<{ adj: AdjustmentDto; decision: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useAdjustments({ status, branch, limit: 50 });
  const canApprove = Boolean(user?.permissions.includes(PERMISSIONS.INVENTORY_APPROVE_ADJUSTMENT));

  const decide = async () => {
    if (!review) return;
    setBusy(true);
    try {
      await api.post(`/inventory/adjustments/${review.adj.id}/${review.decision}`, { note: note || undefined });
      await Promise.all(['adjustments', 'inventory', 'movements'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast.success(review.decision === 'approve' ? `${review.adj.reference} applied` : `${review.adj.reference} rejected`);
      setReview(null);
      setNote('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Stock corrections"
        description="Count corrections. Large ones, and all corrections by sales staff, are checked by a second person."
        actions={user?.permissions.includes(PERMISSIONS.INVENTORY_ADJUST) && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New correction</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-52" aria-label="Status">
          <option value="pending">Awaiting approval</option>
          <option value="applied">Applied</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </Select>
        <BranchSelect value={branch} onChange={setBranch} allowAll />
      </div>
      {list.error && <Alert>{errorMessage(list.error)}</Alert>}
      {list.isLoading && <Skeleton className="h-40" />}
      {list.data?.data.length === 0 && (
        <Card><EmptyState icon={ClipboardCheck} title={status === 'pending' ? 'Nothing waiting for approval' : 'No corrections found'} /></Card>
      )}
      <div className="space-y-4">
        {list.data?.data.map((a) => {
          const own = a.requestedBy?.id === user?.id;
          return (
            <Card key={a.id}>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3">
                <div>
                  <p className="font-semibold">{a.reference} <Badge tone={STATUS[a.status].tone} className="ml-1">{STATUS[a.status].label}</Badge></p>
                  <p className="text-xs text-ink-muted">{a.branch.code} · {a.requestedBy?.fullName} · {formatDateTime(a.createdAt)}</p>
                </div>
                {a.status === 'pending' && canApprove && !own && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setReview({ adj: a, decision: 'reject' })}><X className="h-4 w-4" /> Reject</Button>
                    <Button size="sm" onClick={() => setReview({ adj: a, decision: 'approve' })}><Check className="h-4 w-4" /> Approve</Button>
                  </div>
                )}
                {a.status === 'pending' && own && <span className="text-xs text-ink-muted">Waiting for someone else to review</span>}
              </div>
              <div className="px-5 py-3 text-sm">
                <p className="mb-2 text-ink-muted">“{a.reason}”</p>
                <ul className="space-y-1">
                  {a.items.map((i) => (
                    <li key={`${i.product.id}${i.variant?.id ?? ''}`} className="flex justify-between gap-3">
                      <span>{i.product.name}{i.variant && <span className="text-ink-muted"> · {i.variant.label}</span>}</span>
                      <span className={cn('font-semibold tabular-nums', i.delta > 0 ? 'text-success-700' : 'text-danger-700')}>{i.delta > 0 ? '+' : ''}{i.delta}</span>
                    </li>
                  ))}
                </ul>
                {a.reviewedBy && <p className="mt-2 text-xs text-ink-faint">Reviewed by {a.reviewedBy.fullName}{a.reviewNote ? `: ${a.reviewNote}` : ''}</p>}
              </div>
            </Card>
          );
        })}
      </div>
      {creating && <StockDialog action="adjust" open onClose={() => setCreating(false)} />}
      <Dialog
        open={Boolean(review)}
        onOpenChange={(o) => !o && setReview(null)}
        title={review?.decision === 'approve' ? `Approve ${review.adj.reference}?` : `Reject ${review?.adj.reference}?`}
        description={review?.decision === 'approve' ? 'Stock levels change immediately.' : 'Stock levels stay as they are.'}
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setReview(null)}>Cancel</Button><Button variant={review?.decision === 'approve' ? 'primary' : 'danger'} loading={busy} onClick={decide}>{review?.decision === 'approve' ? 'Approve' : 'Reject'}</Button></>}
      >
        <Field label="Note (optional)">{(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </Dialog>
    </>
  );
}
