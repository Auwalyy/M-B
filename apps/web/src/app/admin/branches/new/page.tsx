'use client';

import { type BranchDto, PERMISSIONS } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BranchForm } from '@/components/admin/branch-form';
import { Alert, PageHeader } from '@/components/ui/display';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';

export default function NewBranchPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const canCreate = useCan(PERMISSIONS.BRANCHES_CREATE);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Add a branch"
        description="The branch appears on the website as soon as it is created. You can then assign its administrator and staff."
        back={<Link href="/admin/branches" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Branches</Link>}
      />
      {!canCreate ? (
        <Alert kind="warning">Only the Super Admin can add branches.</Alert>
      ) : (
        <BranchForm
          submitLabel="Create branch"
          onSubmit={async (payload) => {
            const branch = await api.post<BranchDto>('/branches', payload);
            await qc.invalidateQueries({ queryKey: ['branches'] });
            toast.success(`${branch.name} created`);
            router.push(`/admin/branches/${branch.id}`);
          }}
        />
      )}
    </div>
  );
}
