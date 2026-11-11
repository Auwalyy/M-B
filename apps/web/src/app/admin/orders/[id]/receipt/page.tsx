'use client';

import type { ReceiptDto } from '@mb/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Receipt } from '@/components/receipt';
import { Alert, Skeleton } from '@/components/ui/display';
import { api, errorMessage } from '@/lib/api';

export default function AdminReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const r = useQuery({ queryKey: ['receipt', id], queryFn: () => api.get<ReceiptDto>(`/orders/${id}/receipt`) });
  return (
    <div>
      <Link href={`/admin/orders/${id}`} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink print:hidden"><ArrowLeft className="h-4 w-4" /> Order</Link>
      {r.isLoading && <Skeleton className="mx-auto h-96 max-w-md" />}
      {r.error && <Alert>{errorMessage(r.error)}</Alert>}
      {r.data && <Receipt r={r.data} />}
    </div>
  );
}
