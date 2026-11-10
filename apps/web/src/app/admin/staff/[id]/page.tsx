'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  COMPANY_ONLY_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_LABELS,
  type Permission,
  ROLE_LABELS,
  ROLE_RANK,
  STAFF_ROLE_KEYS,
  type StaffDto,
  formatPhone,
  updateStaffSchema,
} from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, Plus, ShieldOff, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { RoleBadge, UserStatusBadge } from '@/components/admin/badges';
import { TempPasswordInput } from '@/components/admin/temp-password';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader, Skeleton } from '@/components/ui/display';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors } from '@/lib/forms';
import { keys, useBranches, useRoles, useStaffMember } from '@/lib/queries';
import { formatDate, formatDateTime, generatePassword, timeAgo } from '@/lib/utils';

type EditIn = z.input<typeof updateStaffSchema>;
type EditOut = z.output<typeof updateStaffSchema>;

function DetailsCard({ staff, canEdit, onSaved, assignableRoles }: { staff: StaffDto; canEdit: boolean; onSaved: (s: StaffDto) => void; assignableRoles: string[] }) {
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<EditIn, unknown, EditOut>({
    resolver: zodResolver(updateStaffSchema),
    defaultValues: { fullName: staff.fullName, phone: staff.phone ? formatPhone(staff.phone) : '', email: staff.email ?? undefined, role: staff.role as EditIn['role'] },
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  if (!canEdit) {
    return (
      <Card>
        <CardHeader title="Details" />
        <CardBody>
          <DescriptionList items={[
            { label: 'Phone', value: staff.phone ? formatPhone(staff.phone) : null },
            { label: 'Email', value: staff.email },
            { label: 'Role', value: staff.roleName },
            { label: 'Added', value: formatDate(staff.createdAt) },
          ]} />
        </CardBody>
      </Card>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const body: EditOut = { ...values };
    if (body.role === staff.role) delete body.role;
    try {
      const updated = await api.patch<StaffDto>(`/users/${staff.id}`, body);
      onSaved(updated);
      form.reset({ fullName: updated.fullName, phone: updated.phone ? formatPhone(updated.phone) : '', email: updated.email ?? undefined, role: updated.role as EditIn['role'] });
      toast.success('Staff details saved');
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['fullName', 'phone', 'email', 'role']));
    }
  });

  return (
    <Card>
      <CardHeader title="Details" />
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError && <Alert>{formError}</Alert>}
          <Field label="Full name" error={errors.fullName?.message} required>{(p) => <Input {...p} {...form.register('fullName')} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone number" error={errors.phone?.message} required>{(p) => <Input {...p} type="tel" {...form.register('phone')} />}</Field>
            <Field label="Email address" error={errors.email?.message}>
              {(p) => <Input {...p} type="email" {...form.register('email', { setValueAs: (v: string) => (v?.trim() ? v : undefined) })} />}
            </Field>
          </div>
          {assignableRoles.length > 1 && (
            <Field label="Role" error={errors.role?.message} hint="Changing to a branch role requires at least one branch below.">
              {(p) => (
                <Select {...p} {...form.register('role')}>
                  {assignableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r as keyof typeof ROLE_LABELS]}</option>)}
                </Select>
              )}
            </Field>
          )}
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save details</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function BranchesCard({ staff, canAssign, onSaved }: { staff: StaffDto; canAssign: boolean; onSaved: (s: StaffDto) => void }) {
  const toast = useToast();
  const branches = useBranches({ status: 'active' });
  const [selected, setSelected] = useState<string[]>(staff.branches.map((b) => b.id));
  const [saving, setSaving] = useState(false);
  const dirty = [...selected].sort().join() !== staff.branches.map((b) => b.id).sort().join();

  if (staff.role === 'SUPER_ADMIN') {
    return (
      <Card>
        <CardHeader title="Branches" />
        <CardBody><p className="text-sm text-ink-muted">Super Admins work across every branch.</p></CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Branches" description={canAssign ? 'Where this person works. Their access changes immediately.' : undefined} />
      <CardBody>
        {!canAssign ? (
          <div className="flex flex-wrap gap-1.5">{staff.branches.map((b) => <Badge key={b.id} tone="brand">{b.code} · {b.name}</Badge>)}</div>
        ) : branches.isLoading ? (
          <Skeleton className="h-20" />
        ) : (
          <div className="space-y-3">
            <div className="grid gap-1 sm:grid-cols-2">
              {branches.data?.data.map((b) => (
                <Checkbox
                  key={b.id}
                  label={b.name}
                  description={b.code}
                  checked={selected.includes(b.id)}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, b.id] : s.filter((x) => x !== b.id)))}
                />
              ))}
            </div>
            <Button
              size="sm"
              disabled={!dirty || selected.length === 0}
              loading={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  onSaved(await api.put<StaffDto>(`/users/${staff.id}/branches`, { branches: selected }));
                  toast.success('Branches updated');
                } catch (err) {
                  toast.error(errorMessage(err));
                } finally {
                  setSaving(false);
                }
              }}
            >
              Save branches
            </Button>
            {selected.length === 0 && <p className="text-xs text-danger-700">Select at least one branch.</p>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function GrantsCard({ staff, onSaved }: { staff: StaffDto; onSaved: (s: StaffDto) => void }) {
  const toast = useToast();
  const branches = useBranches({ status: 'active' });
  const roles = useRoles();
  const [open, setOpen] = useState(false);
  const [branch, setBranch] = useState('');
  const [perms, setPerms] = useState<Permission[]>([]);
  const [days, setDays] = useState('7');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const rolePerms = (roles.data?.find((r) => r.key === staff.role)?.permissions ?? []).filter((p) => !COMPANY_ONLY_PERMISSIONS.includes(p));
  const otherBranches = branches.data?.data.filter((b) => !staff.branches.some((s) => s.id === b.id)) ?? [];

  const submit = async () => {
    setError(null);
    if (!branch || perms.length === 0 || !reason.trim()) {
      setError('Choose a branch, at least one permission and a reason.');
      return;
    }
    setSaving(true);
    try {
      const expiresAt = new Date(Date.now() + Number(days) * 86_400_000).toISOString();
      onSaved(await api.post<StaffDto>(`/users/${staff.id}/branch-access-grants`, { branch, permissions: perms, expiresAt, reason }));
      toast.success('Temporary access granted');
      setOpen(false);
      setBranch('');
      setPerms([]);
      setReason('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Temporary access to other branches"
        description="For cover during leave or busy periods. Access ends automatically."
        actions={<Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={otherBranches.length === 0}><Plus className="h-4 w-4" /> Grant</Button>}
      />
      <CardBody className="p-0">
        {staff.grants.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">No temporary access.</p>
        ) : (
          <ul className="divide-y divide-line">
            {staff.grants.map((g) => (
              <li key={g.id} className="flex items-start gap-3 px-5 py-3">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-ink">{g.branch.name} <span className="font-normal text-ink-muted">until {formatDateTime(g.expiresAt)}</span></p>
                  <p className="text-xs text-ink-muted">{g.permissions.map((p) => PERMISSION_LABELS[p]).join(', ')}</p>
                  <p className="mt-0.5 text-xs text-ink-faint">“{g.reason}”{g.grantedBy && `: ${g.grantedBy.fullName}`}</p>
                </div>
                <ConfirmDialog
                  title="Revoke this access?"
                  description={`${staff.fullName} will immediately lose access to ${g.branch.name}.`}
                  confirmLabel="Revoke access"
                  onConfirm={async () => {
                    try {
                      onSaved(await api.delete<StaffDto>(`/users/${staff.id}/branch-access-grants/${g.id}`));
                      toast.success('Access revoked');
                    } catch (err) {
                      toast.error(errorMessage(err));
                      throw err;
                    }
                  }}
                  trigger={(o) => <Button size="icon" variant="ghost" onClick={o} aria-label={`Revoke access to ${g.branch.name}`}><Trash2 className="h-4 w-4" /></Button>}
                />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Grant temporary branch access"
        description={`Lets ${staff.fullName} act in another branch with selected permissions only.`}
        size="lg"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={saving} onClick={submit}>Grant access</Button></>}
      >
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Branch" required>
              {(p) => (
                <Select {...p} value={branch} onChange={(e) => setBranch(e.target.value)}>
                  <option value="">Choose a branch</option>
                  {otherBranches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Duration" required>
              {(p) => (
                <Select {...p} value={days} onChange={(e) => setDays(e.target.value)}>
                  {[['1', '1 day'], ['3', '3 days'], ['7', '1 week'], ['14', '2 weeks'], ['30', '30 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Permissions in that branch</legend>
            <div className="grid max-h-56 gap-0.5 overflow-y-auto rounded-lg border border-line p-1 sm:grid-cols-2">
              {rolePerms.map((p) => (
                <Checkbox key={p} label={PERMISSION_LABELS[p]} checked={perms.includes(p)} onChange={(e) => setPerms((s) => (e.target.checked ? [...s, p] : s.filter((x) => x !== p)))} />
              ))}
            </div>
          </fieldset>
          <Field label="Reason" required hint="Recorded in the activity log.">
            {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Covering for the Abuja branch admin on leave" />}
          </Field>
        </div>
      </Dialog>
    </Card>
  );
}

function AccountActions({ staff, onSaved, canReset, canStatus }: { staff: StaffDto; onSaved: (s: StaffDto) => void; canReset: boolean; canStatus: boolean }) {
  const toast = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const [password, setPassword] = useState(generatePassword());
  const [busy, setBusy] = useState(false);
  const [resetDone, setResetDone] = useState<string | null>(null);

  const setStatus = async (action: 'activate' | 'suspend' | 'deactivate') => {
    try {
      onSaved(await api.post<StaffDto>(`/users/${staff.id}/${action}`));
      toast.success(action === 'activate' ? 'Account reactivated' : action === 'suspend' ? 'Account suspended' : 'Account deactivated');
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  return (
    <Card>
      <CardHeader title="Account" />
      <CardBody className="space-y-3">
        {canReset && (
          <Button variant="secondary" className="w-full justify-start" onClick={() => { setResetDone(null); setPassword(generatePassword()); setResetOpen(true); }}>
            <KeyRound className="h-4 w-4" /> Reset password
          </Button>
        )}
        {!canStatus ? null : staff.status === 'active' ? (
          <>
            <ConfirmDialog
              title={`Suspend ${staff.fullName}?`}
              description="They are signed out everywhere and cannot sign in until reactivated. Use this for temporary situations."
              confirmLabel="Suspend"
              onConfirm={() => setStatus('suspend')}
              trigger={(o) => <Button variant="secondary" className="w-full justify-start" onClick={o}><ShieldOff className="h-4 w-4" /> Suspend</Button>}
            />
            <ConfirmDialog
              title={`Deactivate ${staff.fullName}?`}
              description="Use this when someone leaves the company. They are signed out everywhere immediately. Their history is kept."
              confirmLabel="Deactivate"
              onConfirm={() => setStatus('deactivate')}
              trigger={(o) => <Button variant="danger-outline" className="w-full justify-start" onClick={o}><Trash2 className="h-4 w-4" /> Deactivate</Button>}
            />
          </>
        ) : (
          <ConfirmDialog
            title={`Reactivate ${staff.fullName}?`}
            description="They will be able to sign in again with their existing password."
            confirmLabel="Reactivate"
            variant="primary"
            onConfirm={() => setStatus('activate')}
            trigger={(o) => <Button className="w-full" onClick={o}>Reactivate account</Button>}
          />
        )}
      </CardBody>
      <Dialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset password"
        description={resetDone ? undefined : `${staff.fullName} will be signed out everywhere and must choose a new password at next sign-in.`}
        footer={
          resetDone ? (
            <Button onClick={() => setResetOpen(false)}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setResetOpen(false)}>Cancel</Button>
              <Button
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    onSaved(await api.post<StaffDto>(`/users/${staff.id}/reset-password`, { temporaryPassword: password }));
                    setResetDone(password);
                  } catch (err) {
                    toast.error(errorMessage(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Reset password
              </Button>
            </>
          )
        }
      >
        {resetDone ? (
          <div className="space-y-3">
            <Alert kind="success">Password reset. Give this temporary password to {staff.fullName} privately:</Alert>
            <p className="rounded-lg border border-dashed border-line-strong bg-subtle p-3 text-center font-mono text-lg font-bold">{resetDone}</p>
          </div>
        ) : (
          <Field label="Temporary password" hint="At least 8 characters with a letter and a number.">
            {(p) => <TempPasswordInput {...p} value={password} onChange={(e) => setPassword(e.target.value)} onGenerate={setPassword} />}
          </Field>
        )}
      </Dialog>
    </Card>
  );
}

export default function StaffDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const staff = useStaffMember(id);

  const back = <Link href="/admin/staff" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Staff</Link>;
  const onSaved = (s: StaffDto) => {
    qc.setQueryData(keys.staffMember(id), s);
    void qc.invalidateQueries({ queryKey: ['staff'] });
    void qc.invalidateQueries({ queryKey: ['branches'] });
  };

  if (staff.isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-64" /></div>;
  if (staff.error || !staff.data || !user) {
    return <><PageHeader title="Staff member" back={back} /><Alert title="Could not open this staff member">{staff.error ? errorMessage(staff.error) : 'Not found.'}</Alert></>;
  }

  const s = staff.data;
  const isSelf = s.id === user.id;
  const can = (p: Permission) => user.permissions.includes(p);
  // Mirrors the API rule: manage only lower roles, unless you are the Super Admin.
  const outranks = user.role === 'SUPER_ADMIN' || ROLE_RANK[s.role] < ROLE_RANK[user.role];
  const assignableRoles = isSelf ? [s.role] : STAFF_ROLE_KEYS.filter((r) => user.role === 'SUPER_ADMIN' || ROLE_RANK[r] < ROLE_RANK[user.role]);

  return (
    <>
      <PageHeader
        title={s.fullName}
        back={back}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <RoleBadge role={s.role} label={s.roleName} />
            <UserStatusBadge status={s.status} />
            {s.mustChangePassword && <Badge tone="warning">Has not set own password yet</Badge>}
            <span className="text-ink-faint">Last sign-in {timeAgo(s.lastLoginAt)}</span>
          </span>
        }
      />
      {isSelf && <Alert kind="info" className="mb-6">This is your own account. Change your password and details from <Link href="/admin/profile" className="font-semibold underline">My profile</Link>.</Alert>}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <DetailsCard key={s.id + s.role} staff={s} canEdit={!isSelf && outranks && can(PERMISSIONS.USERS_UPDATE)} onSaved={onSaved} assignableRoles={assignableRoles} />
          <BranchesCard key={s.branches.map((b) => b.id).join()} staff={s} canAssign={!isSelf && can(PERMISSIONS.USERS_ASSIGN_BRANCHES)} onSaved={onSaved} />
          {can(PERMISSIONS.USERS_GRANT_ACCESS) && s.role !== 'SUPER_ADMIN' && !isSelf && <GrantsCard staff={s} onSaved={onSaved} />}
        </div>
        {!isSelf && outranks && (can(PERMISSIONS.USERS_DEACTIVATE) || can(PERMISSIONS.USERS_RESET_PASSWORD)) && (
          <aside>
            <AccountActions staff={s} onSaved={onSaved} canReset={can(PERMISSIONS.USERS_RESET_PASSWORD)} canStatus={can(PERMISSIONS.USERS_DEACTIVATE)} />
          </aside>
        )}
      </div>
    </>
  );
}
