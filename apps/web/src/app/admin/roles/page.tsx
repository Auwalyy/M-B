'use client';

import { COMPANY_ONLY_PERMISSIONS, PERMISSIONS, PERMISSION_GROUPS, PERMISSION_LABELS, type Permission, type RoleDto } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { RoleBadge } from '@/components/admin/badges';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, Skeleton } from '@/components/ui/display';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { keys, useRoles } from '@/lib/queries';
import { cn } from '@/lib/utils';

function RoleEditor({ role, canEdit }: { role: RoleDto; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [perms, setPerms] = useState<Set<Permission>>(new Set(role.permissions));
  const [saving, setSaving] = useState(false);
  useEffect(() => setPerms(new Set(role.permissions)), [role]);

  const readOnly = !canEdit || role.key === 'SUPER_ADMIN' || role.scope === 'self';
  const dirty = [...perms].sort().join() !== [...role.permissions].sort().join();
  const lockedPerm = (p: Permission) => role.scope !== 'company' && COMPANY_ONLY_PERMISSIONS.includes(p);

  const toggle = (p: Permission) =>
    setPerms((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const update = (r: RoleDto) => qc.setQueryData<RoleDto[]>(keys.roles, (all) => all?.map((x) => (x.id === r.id ? { ...r, userCount: x.userCount } : x)));

  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2">{role.name} {role.customized && <Badge tone="warning">Customised</Badge>}</span>}
        description={role.description}
        actions={
          !readOnly && (
            <>
              {role.customized && (
                <ConfirmDialog
                  title={`Restore default permissions for ${role.name}?`}
                  description="Your changes to this role are replaced by the standard permission set."
                  confirmLabel="Restore defaults"
                  variant="primary"
                  onConfirm={async () => {
                    try {
                      update(await api.post<RoleDto>(`/roles/${role.id}/reset`));
                      toast.success('Default permissions restored');
                    } catch (err) {
                      toast.error(errorMessage(err));
                      throw err;
                    }
                  }}
                  trigger={(o) => <Button size="sm" variant="ghost" onClick={o}><RotateCcw className="h-4 w-4" /> Defaults</Button>}
                />
              )}
              <Button
                size="sm"
                disabled={!dirty}
                loading={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    update(await api.patch<RoleDto>(`/roles/${role.id}`, { permissions: [...perms] }));
                    toast.success(`${role.name} permissions saved. They apply immediately.`);
                  } catch (err) {
                    toast.error(errorMessage(err));
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Save
              </Button>
            </>
          )
        }
      />
      <CardBody>
        {role.key === 'SUPER_ADMIN' && <Alert kind="info" className="mb-4">The Super Admin always has every permission, so nobody can be locked out.</Alert>}
        {role.scope === 'self' && <Alert kind="info">Customers can only see and manage their own account, orders and reservations. They have no staff permissions.</Alert>}
        {role.scope !== 'self' && (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {PERMISSION_GROUPS.map((g) => (
              <fieldset key={g.label}>
                <legend className="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">{g.label}</legend>
                <ul className="space-y-1">
                  {g.permissions.map((p) => {
                    const locked = lockedPerm(p);
                    return (
                      <li key={p}>
                        <label className={cn('flex items-center gap-2 text-sm', readOnly || locked ? 'cursor-default' : 'cursor-pointer')}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-brand-700"
                            checked={perms.has(p)}
                            disabled={readOnly || locked}
                            onChange={() => toggle(p)}
                          />
                          <span className={cn(locked ? 'text-ink-faint' : 'text-ink')}>{PERMISSION_LABELS[p]}</span>
                          {locked && <Lock className="h-3 w-3 text-ink-faint" aria-label="Head office only" />}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function RolesPage() {
  const roles = useRoles();
  const canEdit = useCan(PERMISSIONS.ROLES_UPDATE);
  const [selected, setSelected] = useState<string | null>(null);
  const current = roles.data?.find((r) => r.id === selected) ?? roles.data?.find((r) => r.key === 'BRANCH_ADMIN') ?? roles.data?.[0];

  return (
    <>
      <PageHeader title="Roles & permissions" description="What each role can do. Branch roles always stay within their own branches." />
      {roles.error && <Alert>{errorMessage(roles.error)}</Alert>}
      {roles.isLoading && <Skeleton className="h-96" />}
      {roles.data && current && (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <nav aria-label="Roles" className="space-y-2">
            {roles.data.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelected(r.id)}
                aria-current={r.id === current.id}
                className={cn(
                  'w-full rounded-xl border p-4 text-left transition-colors',
                  r.id === current.id ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-line bg-surface hover:border-line-strong',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <RoleBadge role={r.key} label={r.name} />
                  <span className="text-xs text-ink-muted">{r.userCount ?? 0} {r.userCount === 1 ? 'person' : 'people'}</span>
                </div>
                <p className="mt-2 text-xs text-ink-muted">{r.scope === 'company' ? 'All branches' : r.scope === 'branch' ? 'Own branches only' : 'Own account only'} · {r.permissions.length} permissions</p>
              </button>
            ))}
            <p className="px-1 pt-2 text-xs text-ink-faint"><Lock className="mr-1 inline h-3 w-3" />Head-office permissions (such as creating branches or editing products) cannot be given to branch roles.</p>
          </nav>
          <RoleEditor key={current.id} role={current} canEdit={canEdit} />
        </div>
      )}
    </>
  );
}
