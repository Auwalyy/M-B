'use client';

import { PERMISSIONS } from '@mb/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, History, type LucideIcon, Plus, ShieldCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { actionLabel, actionTone } from '@/components/admin/badges';
import { ButtonLink } from '@/components/ui/button';
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, Skeleton } from '@/components/ui/display';
import { api, errorMessage } from '@/lib/api';
import { hasPermission, useAuth } from '@/lib/auth';
import { useAudit, useBranches } from '@/lib/queries';
import { timeAgo } from '@/lib/utils';

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function StatCard({ icon: Icon, label, value, sub, href, loading }: { icon: LucideIcon; label: string; value: number | string | undefined; sub?: string; href?: string; loading?: boolean }) {
  const body = (
    <Card className="h-full p-5 transition-shadow hover:shadow-pop">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink-muted">{label}</p>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
      </div>
      {loading ? <Skeleton className="mt-3 h-8 w-16" /> : <p className="mt-2 text-3xl font-bold tracking-tight text-ink">{value ?? '—'}</p>}
      {sub && <p className="mt-1 text-xs text-ink-muted">{sub}</p>}
    </Card>
  );
  return href ? <Link href={href} className="block rounded-xl">{body}</Link> : body;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const can = (p: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => hasPermission(user, p);

  const branches = useBranches();
  const activeStaff = useQuery({
    queryKey: ['staff', 'dashboard-active'],
    queryFn: () => api.page<{ mustChangePassword: boolean; status: string }>('/users', { status: 'active', limit: 100 }),
    enabled: can(PERMISSIONS.USERS_READ),
  });
  const activity = useAudit('activity', { limit: 8 }, can(PERMISSIONS.AUDIT_READ));

  if (!user) return null;
  const branchList = branches.data?.data ?? [];
  const activeBranches = branchList.filter((b) => b.status === 'active').length;
  const awaitingFirstLogin = activeStaff.data?.data.filter((u) => u.mustChangePassword).length ?? 0;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user.fullName.split(' ')[0]}`}
        description={user.scope === 'company' ? 'Overview of every Mudassir & Brothers branch.' : `Overview of ${user.branches.map((b) => b.name).join(', ')}.`}
        actions={
          <>
            {can(PERMISSIONS.USERS_CREATE) && <ButtonLink href="/admin/staff/new" variant="secondary"><Plus className="h-4 w-4" /> Add staff</ButtonLink>}
            {can(PERMISSIONS.BRANCHES_CREATE) && <ButtonLink href="/admin/branches/new"><Plus className="h-4 w-4" /> Add branch</ButtonLink>}
          </>
        }
      />

      {branches.error && <Alert className="mb-6">{errorMessage(branches.error)}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Building2}
          label={user.scope === 'company' ? 'Branches' : 'Your branches'}
          value={activeBranches}
          sub={branchList.length > activeBranches ? `${branchList.length - activeBranches} inactive` : 'All active'}
          href="/admin/branches"
          loading={branches.isLoading}
        />
        {can(PERMISSIONS.USERS_READ) && (
          <StatCard icon={Users} label="Active staff" value={activeStaff.data?.meta.total} sub={awaitingFirstLogin ? `${awaitingFirstLogin} yet to set their own password` : 'Everyone has signed in'} href="/admin/staff" loading={activeStaff.isLoading} />
        )}
        <StatCard icon={ShieldCheck} label="Your role" value={user.roleName} sub={`${user.permissions.length} permissions`} />
        {user.grants.length > 0 && <StatCard icon={History} label="Temporary access" value={user.grants.length} sub={user.grants.map((g) => g.branch.code).join(', ')} />}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {can(PERMISSIONS.AUDIT_READ) && (
          <Card>
            <CardHeader title="Recent activity" description="The latest changes in your scope." actions={<ButtonLink href="/admin/audit" variant="ghost" size="sm">View all <ArrowRight className="h-4 w-4" /></ButtonLink>} />
            <CardBody className="p-0">
              {activity.isLoading && <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>}
              {activity.data?.data.length === 0 && <p className="p-5 text-sm text-ink-muted">No activity yet.</p>}
              <ul className="divide-y divide-line">
                {activity.data?.data.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                    <Badge tone={actionTone(a.action)} className="mt-0.5">{a.branch?.code ?? 'HQ'}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">
                        <strong className="font-semibold">{a.actor?.fullName ?? 'System'}</strong> · {actionLabel(a.action).toLowerCase()}
                        {a.entity?.label && <span className="text-ink-muted"> · {a.entity.label}</span>}
                      </p>
                      <p className="text-xs text-ink-faint">{timeAgo(a.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title={user.scope === 'company' ? 'Branches' : 'Your branches'} />
          <CardBody className="p-0">
            {branches.isLoading && <div className="space-y-3 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>}
            <ul className="divide-y divide-line">
              {branchList.map((b) => (
                <li key={b.id}>
                  <Link href={`/admin/branches/${b.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-subtle">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{b.name}</p>
                      <p className="text-xs text-ink-muted">{b.code} · {b.city} · {b.staffCount ?? 0} staff</p>
                    </div>
                    {b.status === 'active' ? <Badge tone="success" dot>Active</Badge> : <Badge dot>Inactive</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
