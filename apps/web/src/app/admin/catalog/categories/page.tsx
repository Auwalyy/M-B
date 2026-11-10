'use client';

import { type CategoryDto, PERMISSIONS, categorySchema } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ImageDrop, Thumb } from '@/components/admin/commerce';
import { categoryOptions } from '@/components/admin/product-form';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { keys2, useCategories } from '@/lib/queries';

interface Draft { name: string; parent: string; description: string; sortOrder: string; status: 'active' | 'inactive' }

function CategoryDialog({ open, onClose, editing, all }: { open: boolean; onClose: () => void; editing: CategoryDto | null; all: CategoryDto[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState<Draft>({ name: '', parent: '', description: '', sortOrder: '0', status: 'active' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = `${open}-${editing?.id ?? 'new'}`;
  if (key !== lastKey) {
    setLastKey(key);
    setD(editing ? { name: editing.name, parent: editing.parent ?? '', description: editing.description ?? '', sortOrder: String(editing.sortOrder), status: editing.status } : { name: '', parent: '', description: '', sortOrder: '0', status: 'active' });
    setError(null);
  }
  // A category cannot move under itself or its own subcategories.
  const parents = categoryOptions(all).filter((o) => !editing || (o.id !== editing.id && !all.find((c) => c.id === o.id)?.ancestors.includes(editing.id)));

  const save = async () => {
    const body = { name: d.name, parent: d.parent || null, description: d.description || undefined, sortOrder: Number(d.sortOrder) || 0, status: d.status };
    const parsed = categorySchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setBusy(true);
    try {
      if (editing) await api.patch(`/categories/${editing.id}`, body);
      else await api.post('/categories', body);
      await qc.invalidateQueries({ queryKey: keys2.categories });
      toast.success(editing ? 'Category saved' : 'Category created');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={editing ? `Edit ${editing.name}` : 'New category'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{editing ? 'Save' : 'Create'}</Button></>}
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Name" required>{(p) => <Input {...p} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus />}</Field>
        <Field label="Parent category" hint="Leave empty for a top-level category.">
          {(p) => (
            <Select {...p} value={d.parent} onChange={(e) => setD({ ...d, parent: e.target.value })}>
              <option value="">None (top level)</option>
              {parents.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Description">{(p) => <Textarea {...p} rows={3} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Display order" hint="Lower numbers come first.">{(p) => <Input {...p} type="number" value={d.sortOrder} onChange={(e) => setD({ ...d, sortOrder: e.target.value })} />}</Field>
          <Field label="Status">
            {(p) => (
              <Select {...p} value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as Draft['status'] })}>
                <option value="active">Active</option>
                <option value="inactive">Hidden</option>
              </Select>
            )}
          </Field>
        </div>
        {editing && (
          <ImageDrop
            label={editing.image ? 'Replace image' : 'Add image'}
            onFiles={async (files) => {
              try {
                await api.upload(`/categories/${editing.id}/image`, 'image', files.slice(0, 1));
                await qc.invalidateQueries({ queryKey: keys2.categories });
                toast.success('Image updated');
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          />
        )}
      </div>
    </Dialog>
  );
}

export default function CategoriesPage() {
  const categories = useCategories();
  const canWrite = useCan(PERMISSIONS.CATEGORIES_WRITE);
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<{ open: boolean; editing: CategoryDto | null }>({ open: false, editing: null });
  const all = categories.data ?? [];
  const tree = useMemo(() => categoryOptions(all), [all]);
  const byId = new Map(all.map((c) => [c.id, c]));

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Categories"
        description="Group products for the website menu and filters. Up to four levels deep."
        actions={canWrite && <Button onClick={() => setDialog({ open: true, editing: null })}><Plus className="h-4 w-4" /> New category</Button>}
      />
      {categories.error && <Alert>{errorMessage(categories.error)}</Alert>}
      <Card>
        {categories.isLoading ? (
          <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : tree.length === 0 ? (
          <EmptyState icon={FolderTree} title="No categories yet" description="Create top-level categories like Electronics or Home appliances, then add subcategories." action={canWrite && <Button onClick={() => setDialog({ open: true, editing: null })}><Plus className="h-4 w-4" /> New category</Button>} />
        ) : (
          <ul className="divide-y divide-line">
            {tree.map((o) => {
              const c = byId.get(o.id)!;
              return (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5" style={{ paddingLeft: `${1 + c.ancestors.length * 1.5}rem` }}>
                  <Thumb url={c.image?.url} alt="" size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{c.name} {c.status !== 'active' && <Badge>Hidden</Badge>}</p>
                    <p className="text-xs text-ink-muted">{c.productCount ?? 0} product{c.productCount === 1 ? '' : 's'}</p>
                  </div>
                  {canWrite && (
                    <>
                      <Button size="icon" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setDialog({ open: true, editing: c })}><Pencil className="h-4 w-4" /></Button>
                      <ConfirmDialog
                        title={`Delete ${c.name}?`}
                        description="Only empty categories can be deleted. To stop using a category that has products, set it to Hidden instead."
                        confirmLabel="Delete"
                        onConfirm={async () => {
                          try {
                            await api.delete(`/categories/${c.id}`);
                            await qc.invalidateQueries({ queryKey: keys2.categories });
                            toast.success('Category deleted');
                          } catch (err) {
                            toast.error(errorMessage(err));
                            throw err;
                          }
                        }}
                        trigger={(open) => <Button size="icon" variant="ghost" aria-label={`Delete ${c.name}`} onClick={open}><Trash2 className="h-4 w-4" /></Button>}
                      />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <CategoryDialog open={dialog.open} editing={dialog.editing} all={all} onClose={() => setDialog({ open: false, editing: null })} />
    </div>
  );
}
