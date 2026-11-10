'use client';

import { type BrandDto, PERMISSIONS, brandSchema } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ImageDrop, Thumb } from '@/components/admin/commerce';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { keys2, useBrands } from '@/lib/queries';

export default function BrandsPage() {
  const brands = useBrands();
  const canWrite = useCan(PERMISSIONS.BRANDS_WRITE);
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<BrandDto | 'new' | null>(null);
  const [d, setD] = useState({ name: '', description: '', website: '', status: 'active' as 'active' | 'inactive' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (b: BrandDto | 'new') => {
    setEditing(b);
    setError(null);
    setD(b === 'new' ? { name: '', description: '', website: '', status: 'active' } : { name: b.name, description: b.description ?? '', website: b.website ?? '', status: b.status });
  };
  const current = editing && editing !== 'new' ? brands.data?.find((b) => b.id === editing.id) ?? editing : null;

  const save = async () => {
    const body = { name: d.name, description: d.description || undefined, website: d.website || undefined, status: d.status };
    const parsed = brandSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setBusy(true);
    try {
      if (current) await api.patch(`/brands/${current.id}`, body);
      else await api.post('/brands', body);
      await qc.invalidateQueries({ queryKey: keys2.brands });
      toast.success('Brand saved');
      setEditing(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader title="Brands" description="Manufacturers and labels customers can filter by." actions={canWrite && <Button onClick={() => open('new')}><Plus className="h-4 w-4" /> New brand</Button>} />
      {brands.error && <Alert>{errorMessage(brands.error)}</Alert>}
      <Card>
        {brands.isLoading ? (
          <div className="space-y-3 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : brands.data?.length === 0 ? (
          <EmptyState icon={Tag} title="No brands yet" action={canWrite && <Button onClick={() => open('new')}><Plus className="h-4 w-4" /> New brand</Button>} />
        ) : (
          <ul className="divide-y divide-line">
            {brands.data?.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-4 py-3">
                <Thumb url={b.logo?.url} alt="" size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{b.name} {b.status !== 'active' && <Badge>Hidden</Badge>}</p>
                  <p className="text-xs text-ink-muted">{b.productCount ?? 0} product{b.productCount === 1 ? '' : 's'}</p>
                </div>
                {canWrite && (
                  <>
                    <Button size="icon" variant="ghost" aria-label={`Edit ${b.name}`} onClick={() => open(b)}><Pencil className="h-4 w-4" /></Button>
                    <ConfirmDialog
                      title={`Delete ${b.name}?`}
                      description="Only brands without products can be deleted. Otherwise set it to Hidden."
                      confirmLabel="Delete"
                      onConfirm={async () => {
                        try {
                          await api.delete(`/brands/${b.id}`);
                          await qc.invalidateQueries({ queryKey: keys2.brands });
                          toast.success('Brand deleted');
                        } catch (err) {
                          toast.error(errorMessage(err));
                          throw err;
                        }
                      }}
                      trigger={(o) => <Button size="icon" variant="ghost" aria-label={`Delete ${b.name}`} onClick={o}><Trash2 className="h-4 w-4" /></Button>}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={current ? `Edit ${current.name}` : 'New brand'}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}
      >
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Name" required>{(p) => <Input {...p} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus />}</Field>
          <Field label="Website">{(p) => <Input {...p} value={d.website} onChange={(e) => setD({ ...d, website: e.target.value })} placeholder="https://www.samsung.com/ng" />}</Field>
          <Field label="Description">{(p) => <Textarea {...p} rows={3} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />}</Field>
          <Field label="Status">
            {(p) => (
              <Select {...p} value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as 'active' | 'inactive' })}>
                <option value="active">Active</option>
                <option value="inactive">Hidden</option>
              </Select>
            )}
          </Field>
          {current && (
            <ImageDrop
              label={current.logo ? 'Replace logo' : 'Add logo'}
              onFiles={async (files) => {
                try {
                  await api.upload(`/brands/${current.id}/logo`, 'image', files.slice(0, 1));
                  await qc.invalidateQueries({ queryKey: keys2.brands });
                  toast.success('Logo updated');
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            />
          )}
        </div>
      </Dialog>
    </div>
  );
}
