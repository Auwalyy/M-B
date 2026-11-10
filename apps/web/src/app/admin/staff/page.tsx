'use client';

import { PERMISSIONS, ROLE_LABELS, STAFF_ROLE_KEYS, type StaffDto, formatPhone } from '@mb/shared';
import { Plus, Search, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useDeferredValue, useState } from 'react';
import { RoleBadge, UserStatusBadge } from '@/components/admin/badges';
import { ButtonLink } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Card, PageHeader } from '@/components/ui/display';
import { Input, Select } from '@/components/ui/field';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useBranches, useStaff } from '@/lib/queries';
import { timeAgo } from '@/lib/utils';

function StaffList() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const canCreate = Boolean(user?.permissions.includes(PERMISSIONS.USERS_CREATE));
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [branch, setBranch] = useState(params.get('branch') ?? '');
  const [page, setPage] = useState(1);
  const search = useDeferredValue(q);
  const staff = useStaff({ q: search, role, status, branch, page, limit: 20 });
  const branches = useBranches();
  const filtered = Boolean(q || role || status || branch);
  const roleOptions = user?.scope === 'company' ? STAFF_ROLE_KEYS : STAFF_ROLE_KEYS.filter((r) => r !== 'SUPER_ADMIN');

  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Staff"
        description={user?.scope === 'company' ? 'Everyone with access to the admin, across all branches.' : 'Staff at your branches.'}
        actions={canCreate && <ButtonLink href="/admin/staff/new"><Plus className="h-4 w-4" /> Add staff</ButtonLink>}
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input value={q} onChange={(e) => resetPage(setQ)(e.target.value)} placeholder="Search name, email or phone" className="pl-9" aria-label="Search staff" />
          </div>
          {(branches.data?.data.length ?? 0) > 1 && (
            <Select value={branch} onChange={(e) => resetPage(setBranch)(e.target.value)} className="w-48" aria-label="Filter by branch">
              <option value="">All branches</option>
              {branches.data?.data.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
            </Select>
          )}
          <Select value={role} onChange={(e) => resetPage(setRole)(e.target.value)} className="w-40" aria-label="Filter by role">
            <option value="">All roles</option>
            {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
          <Select value={status} onChange={(e) => resetPage(setStatus)(e.target.value)} className="w-36" aria-label="Filter by status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deactivated">Deactivated</option>
          </Select>
        </div>
        <DataTable<StaffDto>
          caption="Staff"
          rows={staff.data?.data}
          rowKey={(u) => u.id}
          loading={staff.isLoading}
          error={staff.error ? errorMessage(staff.error) : null}
          onRetry={() => staff.refetch()}
          onRowClick={(u) => router.push(`/admin/staff/${u.id}`)}
          meta={staff.data?.meta}
          onPageChange={setPage}
          empty={{
            icon: Users,
            title: filtered ? 'No staff match your filters' : 'No staff yet',
            action: canCreate && !filtered ? <ButtonLink href="/admin/staff/new"><Plus className="h-4 w-4" /> Add staff</ButtonLink> : undefined,
          }}
          columns={[
            {
              header: 'Name',
              cell: (u) => (
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{u.fullName} {u.id === user?.id && <span className="font-normal text-ink-faint">(you)</span>}</p>
                  <p className="truncate text-xs text-ink-muted">{u.email ?? (u.phone ? formatPhone(u.phone) : '')}</p>
                </div>
              ),
            },
            { header: 'Role', cell: (u) => <RoleBadge role={u.role} label={u.roleName} /> },
            {
              header: 'Branches',
              hideOnMobile: true,
              cell: (u) =>
                u.role === 'SUPER_ADMIN' ? (
                  <span className="text-ink-muted">All</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {u.branches.map((b) => <Badge key={b.id}>{b.code}</Badge>)}
                    {u.grants.map((g) => <Badge key={g.id} tone="accent">{g.branch.code}*</Badge>)}
                  </div>
                ),
            },
            {
              header: 'Last sign-in',
              hideOnMobile: true,
              cell: (u) => (u.mustChangePassword ? <Badge tone="warning">Awaiting first sign-in</Badge> : <span className="text-ink-muted">{timeAgo(u.lastLoginAt)}</span>),
            },
            { header: 'Status', cell: (u) => <UserStatusBadge status={u.status} /> },
          ]}
        />
      </Card>
      <p className="mt-3 text-xs text-ink-faint">* Temporary access to another branch, granted by the Super Admin.</p>
    </>
  );
}

export default function StaffPage() {
  return (
    <Suspense>
      <StaffList />
    </Suspense>
  );
}
