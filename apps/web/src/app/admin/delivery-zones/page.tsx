'use client';

import { type DeliveryZoneDto, deliveryZoneSchema, formatNaira } from '@mb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Truck } from 'lucide-react';
import { useState } from 'react';
import { BranchSelect, NairaInput } from '@/components/admin/commerce';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/display';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { nairaInputValue, parseNaira } from '@/lib/utils';

export default function DeliveryZonesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [branch, setBranch] = useState('');
  const zones = useQuery({ queryKey: ['zones-admin', branch], queryFn: () => api.get<DeliveryZoneDto[]>('/delivery-zones', { branch }) });
  const [editing, setEditing] = useState<DeliveryZoneDto | 'new' | null>(null);
  const [d, setD] = useState({ branch: '', name: '', areas: '', fee: '', freeAbove: '', estimatedDays: '1', status: 'active' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  const open = (z: DeliveryZoneDto | 'new') => {
    setError(null);
    setEditing(z);
    setD(z === 'new'
      ? { branch: branch || (user?.scope === 'branch' ? user.branches[0]?.id ?? '' : ''), name: '', areas: '', fee: '', freeAbove: '', estimatedDays: '1', status: 'active' }
      : { branch: z.branch.id, name: z.name, areas: z.areas.join(', '), fee: nairaInputValue(z.fee), freeAbove: nairaInputValue(z.freeAbove), estimatedDays: String(z.estimatedDays), status: z.status });
  };

  const save = async () => {
    setError(null);
    const fee = parseNaira(d.fee);
    const freeAbove = parseNaira(d.freeAbove);
    const body = { branch: d.branch, name: d.name, areas: d.areas.split(',').map((a) => a.trim()).filter(Boolean), fee: fee ?? Number.NaN, freeAbove: freeAbove ?? null, estimatedDays: Number(d.estimatedDays) || 0, status: d.status as 'active' | 'inactive' };
    const parsed = deliveryZoneSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]!.path[0] === 'fee' ? 'Enter the delivery fee (0 for free).' : parsed.error.issues[0]!.message);
    setBusy(true);
    try {
      if (editing && editing !== 'new') {
        const { branch: _b, ...rest } = body;
        await api.patch(`/delivery-zones/${editing.id}`, rest);
      } else await api.post('/delivery-zones', body);
      await qc.invalidateQueries({ queryKey: ['zones-admin'] });
      toast.success('Delivery area saved');
      setEditing(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Delivery areas" description="Where each branch delivers, and what it costs. Customers choose their area at checkout." actions={<Button onClick={() => open('new')}><Plus className="h-4 w-4" /> Add area</Button>} />
      <div className="mb-4"><BranchSelect value={branch} onChange={setBranch} allowAll /></div>
      <Card>
        <DataTable<DeliveryZoneDto>
          caption="Delivery areas"
          rows={zones.data}
          rowKey={(z) => z.id}
          loading={zones.isLoading}
          error={zones.error ? errorMessage(zones.error) : null}
          onRowClick={open}
          empty={{ icon: Truck, title: 'No delivery areas yet', description: 'Without delivery areas, customers can only choose pickup.' }}
          columns={[
            { header: 'Area', cell: (z) => <div><p className="font-semibold">{z.name}</p><p className="text-xs text-ink-muted">{z.areas.join(', ') || '—'}</p></div> },
            { header: 'Branch', hideOnMobile: true, cell: (z) => <Badge>{z.branch.code}</Badge> },
            { header: 'Fee', cell: (z) => <span className="tabular-nums">{z.fee ? formatNaira(z.fee) : 'Free'}{z.freeAbove ? <span className="block text-xs text-ink-muted">free over {formatNaira(z.freeAbove)}</span> : null}</span> },
            { header: 'Time', hideOnMobile: true, cell: (z) => (z.estimatedDays ? `${z.estimatedDays} day${z.estimatedDays === 1 ? '' : 's'}` : 'Same day') },
            { header: 'Status', cell: (z) => (z.status === 'active' ? <Badge tone="success" dot>Active</Badge> : <Badge dot>Off</Badge>) },
            { header: '', cell: () => <Pencil className="h-4 w-4 text-ink-faint" aria-hidden /> },
          ]}
        />
      </Card>
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing && editing !== 'new' ? `Edit ${editing.name}` : 'New delivery area'}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}
      >
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          {editing === 'new' && <Field label="Branch" required>{() => <BranchSelect value={d.branch} onChange={(b) => setD({ ...d, branch: b })} className="w-full" />}</Field>}
          <Field label="Name" required>{(p) => <Input {...p} value={d.name} onChange={set('name')} placeholder="Kano city centre" />}</Field>
          <Field label="Neighbourhoods covered" hint="Comma separated. Shown to customers.">{(p) => <Input {...p} value={d.areas} onChange={set('areas')} placeholder="Nassarawa, Fagge, Sabon Gari" />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Delivery fee" required>{(p) => <NairaInput {...p} value={d.fee} onChange={set('fee')} />}</Field>
            <Field label="Free delivery over" hint="Optional">{(p) => <NairaInput {...p} value={d.freeAbove} onChange={set('freeAbove')} />}</Field>
            <Field label="Delivery time (days)" hint="0 for same day">{(p) => <Input {...p} type="number" min={0} max={30} value={d.estimatedDays} onChange={set('estimatedDays')} />}</Field>
            <Field label="Status">{(p) => <Select {...p} value={d.status} onChange={set('status')}><option value="active">Active</option><option value="inactive">Off</option></Select>}</Field>
          </div>
        </div>
      </Dialog>
    </>
  );
}
