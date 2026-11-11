'use client';

import { type ReceiptDto, formatNaira, formatPhone } from '@mb/shared';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/utils';

const METHOD: Record<string, string> = { cash: 'Cash', pos: 'Card (POS)', bank_transfer: 'Bank transfer', paystack: 'Card (online)', pay_on_pickup: 'At pickup', pay_on_delivery: 'On delivery' };

/** Printable receipt. Uses print styles so only the receipt is printed. */
export function Receipt({ r }: { r: ReceiptDto }) {
  return (
    <div>
      <div className="mb-4 flex justify-end print:hidden">
        <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print or save as PDF</Button>
      </div>
      <article className="mx-auto max-w-md rounded-xl border border-line bg-white p-6 text-sm text-ink print:max-w-none print:border-0 print:p-0">
        <header className="border-b border-dashed border-line-strong pb-4 text-center">
          <p className="text-lg font-extrabold">{r.company.name}</p>
          <p className="text-xs text-ink-muted">{r.branch.name} · {r.branch.address}</p>
          <p className="text-xs text-ink-muted">{formatPhone(r.branch.phone)} · {r.company.email}</p>
        </header>
        <dl className="grid grid-cols-2 gap-y-1 border-b border-dashed border-line-strong py-3 text-xs">
          <dt className="text-ink-muted">Receipt</dt><dd className="text-right font-semibold">{r.receiptNumber}</dd>
          <dt className="text-ink-muted">Order</dt><dd className="text-right">{r.order.reference}</dd>
          <dt className="text-ink-muted">Date</dt><dd className="text-right">{formatDateTime(r.order.createdAt)}</dd>
          <dt className="text-ink-muted">Customer</dt><dd className="text-right">{r.customer.fullName} · {formatPhone(r.customer.phone)}</dd>
        </dl>
        <table className="w-full border-b border-dashed border-line-strong py-2 text-xs">
          <tbody>
            {r.items.map((i, idx) => (
              <tr key={idx} className="align-top">
                <td className="py-1.5 pr-2">{i.name}<span className="block text-ink-faint">{i.quantity} × {formatNaira(i.unitPrice)}</span></td>
                <td className="py-1.5 text-right tabular-nums">{formatNaira(i.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="space-y-1 border-b border-dashed border-line-strong py-3">
          <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{formatNaira(r.subtotal)}</dd></div>
          {r.discount > 0 && <div className="flex justify-between"><dt>Discount</dt><dd className="tabular-nums">−{formatNaira(r.discount)}</dd></div>}
          {r.deliveryFee > 0 && <div className="flex justify-between"><dt>Delivery</dt><dd className="tabular-nums">{formatNaira(r.deliveryFee)}</dd></div>}
          <div className="flex justify-between text-base font-bold"><dt>Total</dt><dd className="tabular-nums">{formatNaira(r.total)}</dd></div>
          {r.vatAmount !== null && <div className="flex justify-between text-xs text-ink-muted"><dt>Includes VAT ({r.company.vat.ratePercent}%)</dt><dd className="tabular-nums">{formatNaira(r.vatAmount)}</dd></div>}
        </dl>
        <dl className="space-y-1 py-3 text-xs">
          {r.payments.map((p, i) => <div key={i} className="flex justify-between"><dt>{METHOD[p.method] ?? p.method} · {p.reference}</dt><dd className="tabular-nums">{formatNaira(p.amount)}</dd></div>)}
          <div className="flex justify-between font-semibold"><dt>Paid</dt><dd className="tabular-nums">{formatNaira(r.amountPaid)}</dd></div>
          {r.outstanding > 0 && <div className="flex justify-between font-semibold text-danger-700"><dt>Balance due</dt><dd className="tabular-nums">{formatNaira(r.outstanding)}</dd></div>}
        </dl>
        {r.company.footer && <p className="border-t border-dashed border-line-strong pt-3 text-center text-xs text-ink-muted">{r.company.footer}</p>}
      </article>
    </div>
  );
}
