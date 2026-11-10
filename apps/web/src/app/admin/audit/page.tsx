'use client';

import { type AuditLogDto, PERMISSIONS } from '@mb/shared';
import { History } from 'lucide-react';
import { useState } from 'react';
import { actionLabel, actionTone } from '@/components/admin/badges';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Card, PageHeader } from '@/components/ui/display';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/field';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAudit, useBranches } from '@/lib/queries';
import { cn, describeDevice, formatDateTime } from '@/lib/utils';

const ACTIVITY_FILTERS = [
  ['', 'All activity'],
  ['branch.', 'Branches'],
  ['user.', 'Staff'],
  ['role.', 'Roles'],
  ['settings.', 'Settings'],
] as const;

const LOGIN_FILTERS = [
  ['', 'All sign-in events'],
  ['login', 'Successful sign-ins'],
  ['login_failed', 'Failed sign-ins'],
  ['account_locked', 'Locked accounts'],
  ['password*', 'Password changes and resets'],
  ['refresh_reuse_detected', 'Blocked suspicious sessions'],
] as const;

function display(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.map(display).join(', ') || '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Field-by-field comparison of what changed. */
function Changes({ entry }: { entry: AuditLogDto }) {
  const before = (entry.before ?? {}) as Record<string, unknown>;
  const after = (entry.after ?? {}) as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (!fields.length) return <p className="text-sm text-ink-muted">No field changes recorded for this event.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-subtle text-xs text-ink-muted uppercase">
          <tr><th className="px-3 py-2">Field</th><th className="px-3 py-2">Before</th><th className="px-3 py-2">After</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {fields.map((f) => (
            <tr key={f}>
              <td className="px-3 py-2 font-medium">{f}</td>
              <td className="max-w-56 px-3 py-2 break-words text-danger-700">{display(before[f])}</td>
              <td className="max-w-56 px-3 py-2 break-words text-success-700">{display(after[f])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditPage() {
  const { user } = useAuth();
  const canActivity = Boolean(user?.permissions.includes(PERMISSIONS.AUDIT_READ));
  const canLogins = Boolean(user?.permissions.includes(PERMISSIONS.AUDIT_READ_LOGINS));
  const [tab, setTab] = useState<'activity' | 'logins'>(canActivity ? 'activity' : 'logins');
  const [action, setAction] = useState('');
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditLogDto | null>(null);
  const branches = useBranches();

  const query = {
    action,
    branch: tab === 'activity' ? branch : '',
    from: from ? new Date(`${from}T00:00:00+01:00`).toISOString() : '',
    to: to ? new Date(`${to}T23:59:59+01:00`).toISOString() : '',
    page,
    limit: 25,
  };
  const logs = useAudit(tab, query, tab === 'activity' ? canActivity : canLogins);
  const filters = tab === 'activity' ? ACTIVITY_FILTERS : LOGIN_FILTERS;
  const reset = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); };

  return (
    <>
      <PageHeader title="Activity log" description="A permanent record of important changes and sign-ins. Entries cannot be edited or deleted." />
      {canActivity && canLogins && (
        <div role="tablist" className="mb-4 inline-flex rounded-lg border border-line bg-surface p-1">
          {(['activity', 'logins'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => { setTab(t); setAction(''); setPage(1); }}
              className={cn('rounded-md px-4 py-1.5 text-sm font-medium', tab === t ? 'bg-brand-700 text-white' : 'text-ink-muted hover:text-ink')}
            >
              {t === 'activity' ? 'Changes' : 'Sign-ins'}
            </button>
          ))}
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <Select value={action} onChange={(e) => reset(setAction)(e.target.value)} className="w-56" aria-label="Filter by type">
            {filters.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          {tab === 'activity' && (branches.data?.data.length ?? 0) > 1 && (
            <Select value={branch} onChange={(e) => reset(setBranch)(e.target.value)} className="w-48" aria-label="Filter by branch">
              <option value="">All branches</option>
              {branches.data?.data.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
            </Select>
          )}
          <label className="text-xs text-ink-muted">From <Input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} className="mt-1 h-9 w-40" /></label>
          <label className="text-xs text-ink-muted">To <Input type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} className="mt-1 h-9 w-40" /></label>
        </div>
        <DataTable<AuditLogDto>
          caption="Activity log"
          rows={logs.data?.data}
          rowKey={(a) => a.id}
          loading={logs.isLoading}
          error={logs.error ? errorMessage(logs.error) : null}
          onRetry={() => logs.refetch()}
          onRowClick={setOpen}
          meta={logs.data?.meta}
          onPageChange={setPage}
          empty={{ icon: History, title: 'Nothing recorded for these filters' }}
          columns={[
            { header: 'When', cell: (a) => <span className="whitespace-nowrap text-ink-muted">{formatDateTime(a.createdAt)}</span> },
            { header: 'Who', cell: (a) => <span className="font-medium">{a.actor?.fullName ?? (tab === 'logins' ? 'Unknown account' : 'System')}</span> },
            { header: 'What', cell: (a) => <Badge tone={actionTone(a.action)}>{actionLabel(a.action)}</Badge> },
            { header: 'Record', hideOnMobile: true, cell: (a) => <span className="text-ink-muted">{a.entity?.label ?? (a.meta && typeof a.meta === 'object' && 'identifier' in a.meta ? String((a.meta as { identifier: string }).identifier) : '—')}</span> },
            { header: tab === 'logins' ? 'Device' : 'Branch', hideOnMobile: true, cell: (a) => (tab === 'logins' ? <span className="text-ink-muted">{describeDevice(a.userAgent)}{a.ip ? ` · ${a.ip}` : ''}</span> : a.branch ? <Badge>{a.branch.code}</Badge> : <span className="text-ink-faint">Head office</span>) },
          ]}
        />
      </Card>

      <Dialog open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)} title={open ? actionLabel(open.action) : ''} size="lg" description={open ? `${open.actor?.fullName ?? 'System'} · ${formatDateTime(open.createdAt)}` : undefined}>
        {open && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-ink-muted">Record</dt><dd>{open.entity ? `${open.entity.kind}: ${open.entity.label ?? open.entity.id}` : '—'}</dd>
              <dt className="text-ink-muted">Branch</dt><dd>{open.branch ? `${open.branch.code} · ${open.branch.name}` : 'Head office'}</dd>
              <dt className="text-ink-muted">Role</dt><dd>{open.actorRole ?? '—'}</dd>
              <dt className="text-ink-muted">Device</dt><dd>{describeDevice(open.userAgent)}{open.ip ? ` · ${open.ip}` : ''}</dd>
              <dt className="text-ink-muted">Reference</dt><dd className="font-mono text-xs">{open.requestId ?? '—'}</dd>
            </dl>
            <Changes entry={open} />
          </div>
        )}
      </Dialog>
    </>
  );
}
