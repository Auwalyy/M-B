'use client';

import { PROMOTION_TYPES, type PromotionDto, type PromotionType, formatNaira, promotionSchema } from '@mb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Tag } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NairaInput } from '@/components/admin/commerce';
import { categoryOptions } from '@/components/admin/product-form';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/display';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAllBranches, useBrands, useCategories } from '@/lib/queries';
import { formatDate, nairaInputValue, parseNaira } from '@/lib/utils';

const TYPE_LABEL: Record<PromotionType, string> = { percentage: 'Percentage off', fixed_amount: 'Amount off', free_delivery: 'Free delivery' };
const toLocal = (iso: string) => new Date(new Date(iso).getTime() + 60 * 60_000).toISOString().slice(0, 16); // WAT (UTC+1)
const fromLocal = (v: string) => new Date(`${v}:00+01:00`).toISOString();

function describe(p: PromotionDto) {
  if (p.type === 'percentage') return `${p.value}% off${p.maxDiscount ? ` (max ${formatNaira(p.maxDiscount)})` : ''}`;
  if (p.type === 'fixed_amount') return `${formatNaira(p.value)} off`;
  return 'Free delivery';
}

interface Draft {
  name: string; code: string; description: string; type: PromotionType; value: string; maxDiscount: string; minOrderAmount: string;
  startsAt: string; endsAt: string; usageLimit: string; perCustomerLimit: string; status: 'active' | 'inactive';
  categories: string[]; brands: string[]; branches: string[];
}

function draftFrom(p?: PromotionDto): Draft {
  const now = new Date().toISOString();
  return {
    name: p?.name ?? '', code: p?.code ?? '', description: p?.description ?? '', type: p?.type ?? 'percentage',
    value: p ? (p.type === 'fixed_amount' ? nairaInputValue(p.value) : String(p.value)) : '10',
    maxDiscount: nairaInputValue(p?.maxDiscount), minOrderAmount: nairaInputValue(p?.minOrderAmount),
    startsAt: toLocal(p?.startsAt ?? now), endsAt: toLocal(p?.endsAt ?? new Date(Date.now() + 7 * 86_400_000).toISOString()),
    usageLimit: p?.usageLimit ? String(p.usageLimit) : '', perCustomerLimit: p?.perCustomerLimit ? String(p.perCustomerLimit) : '',
    status: p?.status ?? 'active', categories: p?.categories ?? [], brands: p?.brands ?? [], branches: p?.branches ?? [],
  };
}

export default function PromotionsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const promos = useQuery({ queryKey: ['promotions'], queryFn: () => api.get<PromotionDto[]>('/promotions') });
  const categories = useCategories();
  const brands = useBrands();
  const branches = useAllBranches();
  const cats = useMemo(() => categoryOptions(categories.data), [categories.data]);
  const [editing, setEditing] = useState<PromotionDto | 'new' | null>(null);
  const [d, setD] = useState<Draft>(draftFrom());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const toggle = (k: 'categories' | 'brands' | 'branches', id: string) => setD({ ...d, [k]: d[k].includes(id) ? d[k].filter((x) => x !== id) : [...d[k], id] });

  const save = async () => {
    setError(null);
    const money = (s: string) => { const k = parseNaira(s); return k === null || Number.isNaN(k) ? null : k; };
    const body = {
      name: d.name, code: d.code.trim() ? d.code.trim().toUpperCase() : null, description: d.description || undefined, type: d.type,
      value: d.type === 'fixed_amount' ? money(d.value) ?? 0 : d.type === 'percentage' ? Number(d.value) : 0,
      maxDiscount: d.type === 'percentage' ? money(d.maxDiscount) : null, minOrderAmount: money(d.minOrderAmount),
      startsAt: fromLocal(d.startsAt), endsAt: fromLocal(d.endsAt),
      usageLimit: d.usageLimit ? Number(d.usageLimit) : null, perCustomerLimit: d.perCustomerLimit ? Number(d.perCustomerLimit) : null,
      status: d.status, categories: d.categories, brands: d.brands, branches: d.branches, products: [],
    };
    const parsed = promotionSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setBusy(true);
    try {
      if (editing && editing !== 'new') await api.patch(`/promotions/${editing.id}`, body);
      else await api.post('/promotions', body);
      await qc.invalidateQueries({ queryKey: ['promotions'] });
      toast.success('Promotion saved');
      setEditing(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Promotions"
        description="Discount codes and automatic offers. Without a code, the best matching promotion applies automatically at checkout."
        actions={<Button onClick={() => { setD(draftFrom()); setError(null); setEditing('new'); }}><Plus className="h-4 w-4" /> New promotion</Button>}
      />
      <Card>
        <DataTable<PromotionDto>
          caption="Promotions"
          rows={promos.data}
          rowKey={(p) => p.id}
          loading={promos.isLoading}
          error={promos.error ? errorMessage(promos.error) : null}
          onRowClick={(p) => { setD(draftFrom(p)); setError(null); setEditing(p); }}
          empty={{ icon: Tag, title: 'No promotions yet' }}
          columns={[
            { header: 'Promotion', cell: (p) => <div><p className="font-semibold">{p.name}</p><p className="text-xs text-ink-muted">{describe(p)}{p.minOrderAmount ? ` on orders over ${formatNaira(p.minOrderAmount)}` : ''}</p></div> },
            { header: 'Code', cell: (p) => (p.code ? <code className="rounded bg-subtle px-1.5 py-0.5 text-sm font-bold">{p.code}</code> : <Badge tone="info">Automatic</Badge>) },
            { header: 'Runs', hideOnMobile: true, cell: (p) => <span className="text-sm text-ink-muted">{formatDate(p.startsAt)} – {formatDate(p.endsAt)}</span> },
            { header: 'Used', hideOnMobile: true, cell: (p) => <span className="tabular-nums">{p.usedCount}{p.usageLimit ? ` / ${p.usageLimit}` : ''}</span> },
            { header: 'Status', cell: (p) => (p.live ? <Badge tone="success" dot>Running</Badge> : p.status === 'inactive' ? <Badge dot>Off</Badge> : <Badge tone="warning" dot>{new Date(p.startsAt) > new Date() ? 'Scheduled' : 'Ended'}</Badge>) },
            { header: '', cell: () => <Pencil className="h-4 w-4 text-ink-faint" aria-hidden /> },
          ]}
        />
      </Card>

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing && editing !== 'new' ? `Edit ${editing.name}` : 'New promotion'}
        size="lg"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save promotion</Button></>}
      >
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>{(p) => <Input {...p} value={d.name} onChange={set('name')} placeholder="Sallah sale" />}</Field>
            <Field label="Code" hint="Leave empty to apply automatically.">{(p) => <Input {...p} value={d.code} onChange={set('code')} className="uppercase" placeholder="SALLAH10" />}</Field>
            <Field label="Type">{(p) => <Select {...p} value={d.type} onChange={set('type')}>{PROMOTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</Select>}</Field>
            {d.type === 'percentage' && <Field label="Percent off" required>{(p) => <Input {...p} type="number" min={1} max={90} value={d.value} onChange={set('value')} />}</Field>}
            {d.type === 'fixed_amount' && <Field label="Amount off" required>{(p) => <NairaInput {...p} value={d.value} onChange={set('value')} />}</Field>}
            {d.type === 'percentage' && <Field label="Maximum discount" hint="Optional cap">{(p) => <NairaInput {...p} value={d.maxDiscount} onChange={set('maxDiscount')} />}</Field>}
            <Field label="Minimum order">{(p) => <NairaInput {...p} value={d.minOrderAmount} onChange={set('minOrderAmount')} />}</Field>
            <Field label="Starts (WAT)" required>{(p) => <Input {...p} type="datetime-local" value={d.startsAt} onChange={set('startsAt')} />}</Field>
            <Field label="Ends (WAT)" required>{(p) => <Input {...p} type="datetime-local" value={d.endsAt} onChange={set('endsAt')} />}</Field>
            <Field label="Total uses allowed" hint="Empty for unlimited">{(p) => <Input {...p} type="number" min={1} value={d.usageLimit} onChange={set('usageLimit')} />}</Field>
            <Field label="Uses per customer" hint="Empty for unlimited">{(p) => <Input {...p} type="number" min={1} value={d.perCustomerLimit} onChange={set('perCustomerLimit')} />}</Field>
            <Field label="Status">{(p) => <Select {...p} value={d.status} onChange={set('status')}><option value="active">On</option><option value="inactive">Off</option></Select>}</Field>
            <Field label="Description" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={d.description} onChange={set('description')} />}</Field>
          </div>
          {d.type !== 'free_delivery' && (
            <details className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold">Limit to categories or brands ({d.categories.length + d.brands.length || 'all products'})</summary>
              <div className="mt-3 grid gap-1 sm:grid-cols-2">
                {cats.map((c) => <Checkbox key={c.id} label={c.label} checked={d.categories.includes(c.id)} onChange={() => toggle('categories', c.id)} />)}
                {brands.data?.map((b) => <Checkbox key={b.id} label={`Brand: ${b.name}`} checked={d.brands.includes(b.id)} onChange={() => toggle('brands', b.id)} />)}
              </div>
            </details>
          )}
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer text-sm font-semibold">Limit to branches ({d.branches.length || 'all branches'})</summary>
            <div className="mt-3 grid gap-1 sm:grid-cols-2">
              {branches.data?.map((b) => <Checkbox key={b.id} label={b.name} checked={d.branches.includes(b.id)} onChange={() => toggle('branches', b.id)} />)}
            </div>
          </details>
        </div>
      </Dialog>
    </>
  );
}
