'use client';

import type { EnquiryDto } from '@mb/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { StaffSaleForm } from '@/components/admin/staff-sale-form';
import { PageHeader, Skeleton } from '@/components/ui/display';
import { api } from '@/lib/api';

function NewOrder() {
  const enquiryId = useSearchParams().get('enquiry');
  const enquiry = useQuery({ queryKey: ['enquiry', enquiryId], queryFn: () => api.get<EnquiryDto>(`/enquiries/${enquiryId}`), enabled: Boolean(enquiryId) });
  if (enquiryId && enquiry.isLoading) return <Skeleton className="h-96" />;
  return <StaffSaleForm mode="order" enquiry={enquiry.data} />;
}

export default function NewOrderPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="New order" description="For customers in the branch, on the phone or on WhatsApp. Stock is held as soon as the order is saved." back={<Link href="/admin/orders" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Orders</Link>} />
      <Suspense><NewOrder /></Suspense>
    </div>
  );
}
