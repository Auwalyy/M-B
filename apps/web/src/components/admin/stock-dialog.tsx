'use client';

import { type AdjustmentDto, PERMISSIONS, type Permission, STOCK_OUT_REASONS } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/queries';
import { BranchSelect, type Line, LineItems, toPayloadLines } from './commerce';

export type StockAction = 'in' | 'out' | 'adjust';

const COPY: Record<StockAction, { title: string; description: string; submit: string; permission: Permission; empty: string }> = {
  in: { title: 'Receive stock', description: 'Record goods delivered to the branch, for example from a supplier.', submit: 'Receive stock', permission: PERMISSIONS.INVENTORY_STOCK_IN, empty: 'Search above to add the products you received.' },
  out: { title: 'Remove stock', description: 'Take out units that are damaged, lost, expired or returned to the supplier.', submit: 'Remove stock', permission: PERMISSIONS.INVENTORY_STOCK_OUT, empty: 'Search above to add the products to remove.' },
  adjust: { title: 'Correct stock count', description: 'After counting the shelf, enter the difference: + for extra units found, − for missing units.', submit: 'Submit correction', permission: PERMISSIONS.INVENTORY_ADJUST, empty: 'Search above to add the products you counted.' },
};

const REASON_LABEL: Record<(typeof STOCK_OUT_REASONS)[number], string> = {
  damaged: 'Damaged', lost: 'Lost or stolen', expired: 'Expired', returned_to_supplier: 'Returned to supplier', internal_use: 'Internal use', other: 'Other',
};

export function StockDialog({ action, open, onClose, defaultBranch }: { action: StockAction; open: boolean; onClose: () => void; defaultBranch?: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useSettings();
  const copy = COPY[action];
  const canAt = (id: string) => user?.scope === 'company' || Boolean(user?.branches.some((b) => b.id === id)) || Boolean(user?.grants.some((g) => g.branch.id === id && g.permissions.includes(copy.permission)));
  const firstOwn = user?.scope === 'branch' ? user.branches[0]?.id ?? '' : '';
  const [branch, setBranch] = useState(defaultBranch || firstOwn);
  const [lines, setLines] = useState<Line[]>([]);
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState<(typeof STOCK_OUT_REASONS)[number]>('damaged');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const threshold = settings.data && 'adjustmentApprovalThreshold' in settings.data ? settings.data.adjustmentApprovalThreshold : null;

  const close = () => {
    setLines([]);
    setReference('');
    setNote('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    setError(null);
    if (!branch) return setError('Choose a branch.');
    if (!lines.length) return setError('Add at least one product.');
    if (action !== 'adjust' && lines.some((l) => l.quantity < 1)) return setError('Quantities must be at least 1.');
    if (action === 'adjust' && lines.some((l) => l.quantity === 0)) return setError('A correction of 0 changes nothing. Remove that line.');
    if (action === 'adjust' && note.trim().length < 3) return setError('Explain the correction (e.g. "Monthly shelf count").');
    setBusy(true);
    try {
      if (action === 'in') {
        await api.post('/inventory/stock-in', { branch, items: toPayloadLines(lines), reference: reference || undefined, note: note || undefined });
        toast.success('Stock received');
      } else if (action === 'out') {
        await api.post('/inventory/stock-out', { branch, items: toPayloadLines(lines), reason, note: note || undefined });
        toast.success('Stock removed');
      } else {
        const adj = await api.post<AdjustmentDto>('/inventory/adjustments', {
          branch,
          items: lines.map((l) => ({ product: l.product.id, variantId: l.variant?.id ?? null, delta: l.quantity })),
          reason: note,
        });
        toast.success(adj.status === 'applied' ? `Correction ${adj.reference} applied` : `Correction ${adj.reference} sent for approval`);
      }
      await Promise.all(['inventory', 'movements', 'adjustments', 'products', 'product'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      close();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK' ? `${err.message} Check the quantities and try again.` : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && close()}
      title={copy.title}
      description={copy.description}
      size="lg"
      footer={<><Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>{copy.submit}</Button></>}
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Branch" required>{() => <BranchSelect value={branch} onChange={setBranch} only={canAt} className="w-full" />}</Field>
        <LineItems lines={lines} onChange={setLines} mode={action === 'adjust' ? 'delta' : 'quantity'} branch={branch} emptyHint={copy.empty} />
        {action === 'in' && <Field label="Supplier invoice / delivery note no." hint="Optional, but helps trace deliveries later.">{(p) => <Input {...p} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>}
        {action === 'out' && (
          <Field label="Reason" required>
            {(p) => (
              <Select {...p} value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
                {STOCK_OUT_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label={action === 'adjust' ? 'Reason for the correction' : 'Note'} required={action === 'adjust'}>
          {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {action === 'adjust' && threshold !== null && (
          <p className="text-xs text-ink-muted">Corrections of more than {threshold} units per line, and all corrections by sales staff, need a second person to approve them.</p>
        )}
      </div>
    </Dialog>
  );
}
