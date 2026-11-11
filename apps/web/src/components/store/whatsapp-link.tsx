'use client';

import type { AnchorHTMLAttributes } from 'react';

/** Records that the visitor opened a WhatsApp chat (intent only: nothing is sent until they press send). */
export function logWhatsAppClick(context: 'product' | 'order' | 'reservation' | 'branch', ref?: string, branch?: string) {
  try {
    const body = JSON.stringify({ context, ref, branch });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/v1/whatsapp/click', new Blob([body], { type: 'application/json' }));
    else void fetch('/api/v1/whatsapp/click', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true });
  } catch {
    // Analytics must never block the customer.
  }
}

export function WhatsAppLink({ context, refId, branch, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { context: 'product' | 'order' | 'reservation' | 'branch'; refId?: string; branch?: string }) {
  return (
    <a
      target="_blank"
      rel="noopener noreferrer"
      {...props}
      onClick={(e) => {
        logWhatsAppClick(context, refId, branch);
        onClick?.(e);
      }}
    />
  );
}
