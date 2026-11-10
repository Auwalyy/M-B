'use client';

import { type BranchDto, NIGERIAN_STATES, PERMISSIONS } from '@mb/shared';
import { Building2, Plus, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { BranchStatusBadge } from '@/components/admin/badges';
import { ButtonLink } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Card, PageHeader } from '@/components/ui/display';
import { Input, Select } from '@/components/ui/field';
import { errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useBranches } from '@/lib/queries';

export default function BranchesPage() {
  const router = useRouter();
  const canCreate = useCan(PERMISSIONS.BRANCHES_CREATE);
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [status, setStatus] = useState('');
  const search = useDeferredValue(q);
  const branches = useBranches({ q: search, state, status });

  return (
    <>
      <PageHeader
        title="Branches"
        description={canCreate ? 'Every branch in the company. Add new locations any time.' : 'The branches you manage.'}
        actions={canCreate && <ButtonLink href="/admin/branches/new"><Plus className="h-4 w-4" /> Add branch</ButtonLink>}
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, code or area" className="pl-9" aria-label="Search branches" />
          </div>
          <Select value={state} onChange={(e) => setState(e.target.value)} className="w-40" aria-label="Filter by state">
            <option value="">All states</option>
            {NIGERIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36" aria-label="Filter by status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>
        <DataTable<BranchDto>
          caption="Branches"
          rows={branches.data?.data}
          rowKey={(b) => b.id}
          loading={branches.isLoading}
          error={branches.error ? errorMessage(branches.error) : null}
          onRetry={() => branches.refetch()}
          onRowClick={(b) => router.push(`/admin/branches/${b.id}`)}
          empty={{
            icon: Building2,
            title: q || state || status ? 'No branches match your filters' : 'No branches yet',
            description: canCreate && !q ? 'Add your first branch to start assigning staff.' : undefined,
            action: canCreate && !q ? <ButtonLink href="/admin/branches/new"><Plus className="h-4 w-4" /> Add branch</ButtonLink> : undefined,
          }}
          columns={[
            {
              header: 'Branch',
              cell: (b) => (
                <div>
                  <p className="font-semibold text-ink">{b.name}</p>
                  <p className="text-xs text-ink-muted">{b.code}</p>
                </div>
              ),
            },
            { header: 'Location', hideOnMobile: true, cell: (b) => <span className="text-ink-muted">{b.area ? `${b.area}, ` : ''}{b.city}, {b.state}</span> },
            { header: 'Admin', hideOnMobile: true, cell: (b) => (b.admins.length ? b.admins.map((a) => a.fullName).join(', ') : <span className="text-warning-700">Not assigned</span>) },
            { header: 'Staff', hideOnMobile: true, cell: (b) => b.staffCount ?? 0 },
            { header: 'Status', cell: (b) => <BranchStatusBadge status={b.status} /> },
          ]}
        />
      </Card>
    </>
  );
}
