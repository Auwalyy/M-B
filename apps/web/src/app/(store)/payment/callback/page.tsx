'use client';

import { formatNaira } from '@mb/shared';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/display';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** Paystack sends the customer back here. We ask our server, which asks Paystack, whether it really succeeded. */
function Callback() {
  const params = useSearchParams();
  const { user } = useAuth();
  const reference = params.get('reference') ?? params.get('trxref') ?? '';
  const result = useQuery({
    queryKey: ['verify', reference],
    queryFn: () => api.get<{ status: string; orderReference: string; amount: number; outstanding: number }>(`/payments/paystack/verify/${encodeURIComponent(reference)}`),
    enabled: /^PAY-[A-Z]{3}\d{2}-\d{6,}$/.test(reference),
    retry: 2,
  });
  const orderLink = (ref: string) => (user ? `/account/orders/${ref}` : `/track?reference=${ref}`);

  if (!reference) return <Alert>This payment link is incomplete.</Alert>;
  if (result.isLoading) return <p className="flex items-center gap-2 text-ink-muted"><Loader2 className="h-5 w-5 animate-spin" /> Checking your payment with Paystack…</p>;
  if (result.error) return <Alert title="We could not check this payment">{errorMessage(result.error)} If money left your account, contact the branch with reference {reference}.</Alert>;
  const r = result.data!;
  return r.status === 'success' ? (
    <div className="rounded-xl border border-success-700/20 bg-success-50 p-6">
      <CheckCircle2 className="h-8 w-8 text-success-700" aria-hidden />
      <h1 className="mt-2 text-2xl font-bold">Payment received</h1>
      <p className="mt-1 text-ink-muted">We received {formatNaira(r.amount)} for order {r.orderReference}. Thank you.</p>
      <ButtonLink href={orderLink(r.orderReference)} className="mt-4">View your order</ButtonLink>
    </div>
  ) : r.status === 'pending' ? (
    <Alert kind="info" title="Payment still processing">Paystack has not confirmed the payment yet. We will update your order automatically once it does. You can close this page.</Alert>
  ) : (
    <div className="rounded-xl border border-danger-600/25 bg-danger-50 p-6">
      <XCircle className="h-8 w-8 text-danger-600" aria-hidden />
      <h1 className="mt-2 text-2xl font-bold">Payment not completed</h1>
      <p className="mt-1 text-ink-muted">No money was taken for order {r.orderReference}. You can try again or choose another way to pay.</p>
      <ButtonLink href={orderLink(r.orderReference)} className="mt-4">Back to your order</ButtonLink>
    </div>
  );
}

export default function PaymentCallbackPage() {
  return <div className="mx-auto max-w-xl px-4 py-12"><Suspense><Callback /></Suspense></div>;
}
