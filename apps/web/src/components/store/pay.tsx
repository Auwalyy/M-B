'use client';

import { type PaymentConfigDto, formatNaira } from '@mb/shared';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, Landmark } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';

export function usePaymentConfig() {
  return useQuery({ queryKey: ['payment-config'], queryFn: () => api.get<PaymentConfigDto>('/payments/config'), staleTime: 10 * 60_000 });
}

/** Sends the customer to Paystack's secure page to pay the order balance by card. */
export async function startCardPayment(reference: string, phone?: string) {
  const { authorizationUrl } = await api.post<{ authorizationUrl: string }>('/payments/paystack/initialize', { order: reference, phone });
  window.location.assign(authorizationUrl);
}

export function PayByCardButton({ reference, phone, amount }: { reference: string; phone?: string; amount: number }) {
  const config = usePaymentConfig();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!config.data?.paystackEnabled || amount <= 0) return null;
  return (
    <Button className="w-full" loading={busy} onClick={async () => {
      setBusy(true);
      try {
        await startCardPayment(reference, phone);
      } catch (err) {
        toast.error(errorMessage(err));
        setBusy(false);
      }
    }}>
      <CreditCard className="h-4 w-4" /> Pay {formatNaira(amount)} by card
    </Button>
  );
}

export function BankTransferDetails({ amount, reference }: { amount: number; reference: string }) {
  const config = usePaymentConfig();
  const bank = config.data?.bankTransfer;
  if (!bank || amount <= 0) return null;
  return (
    <div className="rounded-xl border border-line bg-surface p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold"><Landmark className="h-4 w-4 text-brand-600" aria-hidden /> Pay by bank transfer</p>
      <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1">
        <dt className="text-ink-muted">Amount</dt><dd className="font-semibold">{formatNaira(amount)}</dd>
        <dt className="text-ink-muted">Bank</dt><dd>{bank.bankName}</dd>
        <dt className="text-ink-muted">Account name</dt><dd>{bank.accountName}</dd>
        <dt className="text-ink-muted">Account number</dt><dd className="font-mono font-semibold tracking-wider">{bank.accountNumber}</dd>
        <dt className="text-ink-muted">Narration</dt><dd className="font-mono">{reference}</dd>
      </dl>
      <p className="mt-2 text-xs text-ink-muted">Use your order number as the narration. The branch confirms your order once the money arrives.</p>
    </div>
  );
}
