'use client';

import { CUSTOMER_SOURCES, PERMISSIONS, type SegmentDto, type SegmentFilter, formatNaira, segmentFilterSchema } from '@mb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, SlidersHorizontal, Trash2, Users } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { SOURCE_LABEL } from '@/components/admin/badges';
import { NairaInput } from '@/components/admin/commerce';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { keys2, useAllBranches, useSegments } from '@/lib/queries';
import { nairaInputValue, parseNaira } from '@/lib/utils';

interface Draft {
  name: string; description: string; minTotalSpent: string; maxTotalSpent: string; minOrders: string; maxOrders: string;
  inactiveDays: string; joinedWithinDays: string; preferredBranch: string; branchServed: string; tags: string; source: string;
}
const EMPTY: Draft = { name: '', description: '', minTotalSpent: '', maxTotalSpent: '', minOrders: '', maxOrders: '', inactiveDays: '', joinedWithinDays: '', preferredBranch: '', branchServed: '', tags: '', source: '' };

function toFilter(d: Draft): SegmentFilter {
  const int = (s: string) => (s.trim() ? Math.trunc(Number(s)) : undefined);
  const money = (s: string) => { const k = parseNaira(s); return k === null || Number.isNaN(k) ? undefined : k; };
  const tags = d.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  return Object.fromEntries(
    Object.entries({
      minTotalSpent: money(d.minTotalSpent), maxTotalSpent: money(d.maxTotalSpent), minOrders: int(d.minOrders), maxOrders: int(d.maxOrders),
      inactiveDays: int(d.inactiveDays), joinedWithinDays: int(d.joinedWithinDays), preferredBranch: d.preferredBranch || undefined,
      branchServed: d.branchServed || undefined, tags: tags.length ? tags : undefined, source: d.source || undefined,
    }).filter(([, v]) => v !== undefined),
  ) as SegmentFilter;
}

function fromSegment(s: SegmentDto): Draft {
  const f = s.filter;
  const n = (v?: number) => (v === undefined ? '' : String(v));
  return {
    name: s.name, description: s.description ?? '', minTotalSpent: nairaInputValue(f.minTotalSpent), maxTotalSpent: nairaInputValue(f.maxTotalSpent),
    minOrders: n(f.minOrders), maxOrders: n(f.maxOrders), inactiveDays: n(f.inactiveDays), joinedWithinDays: n(f.joinedWithinDays),
    preferredBranch: f.preferredBranch ?? '', branchServed: f.branchServed ?? '', tags: (f.tags ?? []).join(', '), source: f.source ?? '',
  };
}

function describeFilter(f: SegmentFilter, branchName: (id: string) => string): string[] {
  const out: string[] = [];
  if (f.minTotalSpent !== undefined) out.push(`spent at least ${formatNaira(f.minTotalSpent)}`);
  if (f.maxTotalSpent !== undefined) out.push(`spent at most ${formatNaira(f.maxTotalSpent)}`);
  if (f.minOrders !== undefined) out.push(`${f.minOrders}+ orders`);
  if (f.maxOrders !== undefined) out.push(`at most ${f.maxOrders} orders`);
  if (f.inactiveDays) out.push(`no order in ${f.inactiveDays} days`);
  if (f.joinedWithinDays) out.push(`joined in the last ${f.joinedWithinDays} days`);
  if (f.preferredBranch) out.push(`prefers ${branchName(f.preferredBranch)}`);
  if (f.branchServed) out.push(`served at ${branchName(f.branchServed)}`);
  if (f.tags?.length) out.push(`tagged ${f.tags.join(' + ')}`);
  if (f.source) out.push(`came via ${SOURCE_LABEL[f.source]}`);
  return out;
}

export default function SegmentsPage() {
  const segments = useSegments();
  const branches = useAllBranches();
  const canWrite = useCan(PERMISSIONS.CUSTOMERS_SEGMENTS);
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<SegmentDto | 'new' | null>(null);
  const [d, setD] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filter = useDeferredValue(toFilter(d));
  const valid = segmentFilterSchema.safeParse(filter).success;
  const preview = useQuery({
    queryKey: ['segment-preview', filter],
    queryFn: () => api.post<{ count: number }>('/customer-segments/preview', filter),
    enabled: editing !== null && valid,
  });
  const branchName = (id: string) => branches.data?.find((b) => b.id === id)?.name ?? 'a branch';
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  const save = async () => {
    setError(null);
    if (!d.name.trim()) return setError('Give the segment a name.');
    if (!valid) return setError('Add at least one condition.');
    setBusy(true);
    try {
      const body = { name: d.name, description: d.description || undefined, filter: toFilter(d) };
      if (editing && editing !== 'new') await api.patch(`/customer-segments/${editing.id}`, body);
      else await api.post('/customer-segments', body);
      await qc.invalidateQueries({ queryKey: keys2.segments });
      toast.success('Segment saved');
      setEditing(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Customer segments"
        description="Saved groups of customers, for example big spenders or customers who have not bought in a while. Counts include only customers you can see."
        actions={canWrite && <Button onClick={() => { setD(EMPTY); setError(null); setEditing('new'); }}><Plus className="h-4 w-4" /> New segment</Button>}
      />
      {segments.error && <Alert>{errorMessage(segments.error)}</Alert>}
      {segments.isLoading && <Skeleton className="h-40" />}
      {segments.data?.length === 0 && <Card><EmptyState icon={SlidersHorizontal} title="No segments yet" description="Spending and order conditions start working as soon as orders are recorded." /></Card>}
      <div className="grid gap-4 sm:grid-cols-2">
        {segments.data?.map((s) => (
          <Card key={s.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold">{s.name}</h2>
              <Badge tone="brand"><Users className="h-3 w-3" /> {s.customerCount ?? 0}</Badge>
            </div>
            {s.description && <p className="mt-1 text-sm text-ink-muted">{s.description}</p>}
            <p className="mt-3 text-sm text-ink">Customers who {describeFilter(s.filter, branchName).join(', ')}.</p>
            <div className="mt-auto flex items-center gap-2 pt-4">
              <ButtonLink href={`/admin/customers?segment=${s.id}`} size="sm" variant="secondary">View customers</ButtonLink>
              {canWrite && (
                <>
                  <Button size="icon" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => { setD(fromSegment(s)); setError(null); setEditing(s); }}><Pencil className="h-4 w-4" /></Button>
                  <ConfirmDialog
                    title={`Delete ${s.name}?`}
                    description="Only the saved conditions are deleted. Customers are not affected."
                    confirmLabel="Delete"
                    onConfirm={async () => {
                      try {
                        await api.delete(`/customer-segments/${s.id}`);
                        await qc.invalidateQueries({ queryKey: keys2.segments });
                      } catch (err) {
                        toast.error(errorMessage(err));
                        throw err;
                      }
                    }}
                    trigger={(o) => <Button size="icon" variant="ghost" aria-label={`Delete ${s.name}`} onClick={o}><Trash2 className="h-4 w-4" /></Button>}
                  />
                </>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing && editing !== 'new' ? `Edit ${editing.name}` : 'New segment'}
        size="lg"
        footer={
          <>
            <span className="mr-auto self-center text-sm text-ink-muted">{valid ? (preview.isFetching ? 'Counting…' : `${preview.data?.count ?? 0} matching customers`) : 'Add a condition'}</span>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button loading={busy} onClick={save}>Save segment</Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>{(p) => <Input {...p} value={d.name} onChange={set('name')} placeholder="Big spenders" />}</Field>
            <Field label="Description">{(p) => <Input {...p} value={d.description} onChange={set('description')} />}</Field>
          </div>
          <p className="text-sm font-medium">Customers who match all of these:</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Spent at least">{(p) => <NairaInput {...p} value={d.minTotalSpent} onChange={set('minTotalSpent')} />}</Field>
            <Field label="Spent at most">{(p) => <NairaInput {...p} value={d.maxTotalSpent} onChange={set('maxTotalSpent')} />}</Field>
            <Field label="At least this many orders">{(p) => <Input {...p} type="number" min={0} value={d.minOrders} onChange={set('minOrders')} />}</Field>
            <Field label="At most this many orders">{(p) => <Input {...p} type="number" min={0} value={d.maxOrders} onChange={set('maxOrders')} />}</Field>
            <Field label="No order in the last … days">{(p) => <Input {...p} type="number" min={1} value={d.inactiveDays} onChange={set('inactiveDays')} />}</Field>
            <Field label="Joined in the last … days">{(p) => <Input {...p} type="number" min={1} value={d.joinedWithinDays} onChange={set('joinedWithinDays')} />}</Field>
            <Field label="Preferred branch">{(p) => <Select {...p} value={d.preferredBranch} onChange={set('preferredBranch')}><option value="">Any</option>{branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
            <Field label="Served at branch">{(p) => <Select {...p} value={d.branchServed} onChange={set('branchServed')}><option value="">Any</option>{branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
            <Field label="Has all these tags" hint="Comma separated">{(p) => <Input {...p} value={d.tags} onChange={set('tags')} />}</Field>
            <Field label="Came via">{(p) => <Select {...p} value={d.source} onChange={set('source')}><option value="">Any</option>{CUSTOMER_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</Select>}</Field>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
