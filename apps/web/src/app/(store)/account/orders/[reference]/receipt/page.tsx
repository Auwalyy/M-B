'use client';

import type { ReceiptDto } from '@mb/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Receipt } from '@/components/receipt';
import { Alert, Skeleton } from '@/components/ui/display';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function CustomerReceiptPage() {
  const { reference } = useParams<{ reference: string }>();
  const { status } = useAuth();
  const r = useQuery({ queryKey: ['my-receipt', reference], queryFn: () => api.get<ReceiptDto>(`/orders/mine/${reference}/receipt`), enabled: status === 'authenticated' });
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href={`/account/orders/${reference}`} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink print:hidden"><ArrowLeft className="h-4 w-4" /> Order</Link>
      {(r.isLoading || status === 'loading') && <Skeleton className="mx-auto h-96 max-w-md" />}
      {status === 'anonymous' && <Alert>Sign in to see your receipt.</Alert>}
      {r.error && <Alert>{errorMessage(r.error)}</Alert>}
      {r.data && <Receipt r={r.data} />}
    </div>
  );
}
