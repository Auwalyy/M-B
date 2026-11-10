'use client';

import { type BranchDto, PERMISSIONS, formatPhone } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Users } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { BranchStatusBadge } from '@/components/admin/badges';
import { BranchForm } from '@/components/admin/branch-form';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert, Card, CardBody, CardHeader, DescriptionList, PageHeader, Skeleton } from '@/components/ui/display';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { keys, useBranch } from '@/lib/queries';
import { formatDateTime } from '@/lib/utils';

export default function BranchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const branch = useBranch(id);

  const can = (p: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => Boolean(user?.permissions.includes(p));
  const inScope = (p: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) =>
    can(p) && (user?.scope === 'company' || Boolean(user?.branches.some((b) => b.id === id)));
  const fullEdit = inScope(PERMISSIONS.BRANCHES_UPDATE);
  const profileEdit = !fullEdit && inScope(PERMISSIONS.BRANCHES_UPDATE_PROFILE);
  const canToggle = inScope(PERMISSIONS.BRANCHES_DEACTIVATE);

  const refresh = (b: BranchDto) => {
    qc.setQueryData(keys.branch(id), b);
    void qc.invalidateQueries({ queryKey: ['branches'] });
  };

  const back = <Link href="/admin/branches" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Branches</Link>;

  if (branch.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-64" /></div>;
  }
  if (branch.error || !branch.data) {
    return (
      <>
        <PageHeader title="Branch" back={back} />
        <Alert title="Could not open this branch">{branch.error ? errorMessage(branch.error) : 'Branch not found.'}</Alert>
      </>
    );
  }
  const b = branch.data;
  // A visitor-level view (no admins field) means the user cannot manage this branch.
  const isManaged = 'status' in b;

  const setStatus = async (action: 'activate' | 'deactivate') => {
    try {
      const updated = await api.post<BranchDto>(`/branches/${id}/${action}`);
      refresh(updated);
      toast.success(action === 'activate' ? 'Branch reactivated' : 'Branch deactivated');
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  return (
    <>
      <PageHeader
        title={b.name}
        description={<span className="inline-flex items-center gap-2">{b.code} {isManaged && <BranchStatusBadge status={b.status} />}</span>}
        back={back}
        actions={
          <>
            {isManaged && can(PERMISSIONS.USERS_READ) && (
              <ButtonLink href={`/admin/staff?branch=${b.id}`} variant="secondary"><Users className="h-4 w-4" /> Staff ({b.staffCount ?? 0})</ButtonLink>
            )}
            {canToggle && isManaged && (
              b.status === 'active' ? (
                <ConfirmDialog
                  title={`Deactivate ${b.name}?`}
                  description="The branch disappears from the website and cannot take new orders or reservations. Its records and staff accounts are kept, and you can reactivate it at any time."
                  confirmLabel="Deactivate branch"
                  onConfirm={() => setStatus('deactivate')}
                  trigger={(open) => <Button variant="danger-outline" onClick={open}>Deactivate</Button>}
                />
              ) : (
                <ConfirmDialog
                  title={`Reactivate ${b.name}?`}
                  description="The branch will appear on the website again."
                  confirmLabel="Reactivate"
                  variant="primary"
                  onConfirm={() => setStatus('activate')}
                  trigger={(open) => <Button onClick={open}>Reactivate</Button>}
                />
              )
            )}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div>
          {fullEdit || profileEdit ? (
            <BranchForm
              key={b.updatedAt}
              branch={b}
              profileOnly={profileEdit}
              submitLabel="Save changes"
              onSubmit={async (payload) => {
                const updated = await api.patch<BranchDto>(`/branches/${id}`, payload);
                refresh(updated);
                toast.success('Branch saved');
              }}
            />
          ) : (
            <Card>
              <CardHeader title="Branch details" />
              <CardBody>
                <DescriptionList
                  items={[
                    { label: 'Address', value: `${b.address}${b.area ? `, ${b.area}` : ''}, ${b.city}, ${b.state}` },
                    { label: 'Landmark', value: b.landmark },
                    { label: 'Phone', value: formatPhone(b.phone) },
                    { label: 'WhatsApp', value: formatPhone(b.whatsapp) },
                    { label: 'Email', value: b.email },
                  ]}
                />
              </CardBody>
            </Card>
          )}
        </div>

        {isManaged && (
          <aside className="space-y-6">
            <Card>
              <CardHeader title="Branch administrator" />
              <CardBody>
                {b.admins.length ? (
                  <ul className="space-y-2">
                    {b.admins.map((a) => (
                      <li key={a.id}>
                        {can(PERMISSIONS.USERS_READ) ? <Link href={`/admin/staff/${a.id}`} className="font-medium text-brand-700 hover:underline">{a.fullName}</Link> : a.fullName}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Alert kind="warning">No administrator assigned. {can(PERMISSIONS.USERS_CREATE) && <Link href="/admin/staff/new" className="font-semibold underline">Add one</Link>}</Alert>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Record" />
              <CardBody className="space-y-2 text-sm text-ink-muted">
                <p>Created {formatDateTime(b.createdAt)}</p>
                <p>Last updated {formatDateTime(b.updatedAt)}</p>
              </CardBody>
            </Card>
          </aside>
        )}
      </div>
    </>
  );
}
