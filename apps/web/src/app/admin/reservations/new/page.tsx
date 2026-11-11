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

function NewReservation() {
  const enquiryId = useSearchParams().get('enquiry');
  const enquiry = useQuery({ queryKey: ['enquiry', enquiryId], queryFn: () => api.get<EnquiryDto>(`/enquiries/${enquiryId}`), enabled: Boolean(enquiryId) });
  if (enquiryId && enquiry.isLoading) return <Skeleton className="h-96" />;
  return <StaffSaleForm mode="reservation" enquiry={enquiry.data} />;
}

export default function NewReservationPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Reserve for a customer" description="Holds the items straight away. The customer collects and pays within the hold period." back={<Link href="/admin/reservations" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Reservations</Link>} />
      <Suspense><NewReservation /></Suspense>
    </div>
  );
}
