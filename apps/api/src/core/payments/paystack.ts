import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../errors/AppError';

/** The parts of Paystack's transaction object we rely on. Amounts are in kobo. */
export interface PaystackTransaction {
  id: number;
  reference: string;
  status: 'success' | 'failed' | 'abandoned' | 'ongoing' | 'pending' | 'processing' | 'queued' | 'reversed';
  amount: number;
  currency: string;
  channel?: string;
  paid_at?: string | null;
  gateway_response?: string;
}

let fetchImpl: typeof fetch = (...a) => fetch(...a);
/** Tests replace the HTTP client. */
export function setPaystackFetch(f: typeof fetch): void {
  fetchImpl = f;
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (!env.PAYSTACK_SECRET_KEY) throw new AppError(503, 'PAYMENTS_UNAVAILABLE', 'Card payments are not available right now.');
  const res = await fetchImpl(`${env.PAYSTACK_BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
  if (!res.ok || !json.status || json.data === undefined) {
    logger.warn({ path, status: res.status, message: json.message }, 'Paystack request failed');
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', json.message ? `Payment provider: ${json.message}` : 'The payment provider did not respond. Please try again.');
  }
  return json.data;
}

export function initializeTransaction(p: { email: string; amount: number; reference: string; callbackUrl: string; metadata: Record<string, unknown> }) {
  return call<{ authorization_url: string; access_code: string; reference: string }>('POST', '/transaction/initialize', {
    email: p.email,
    amount: p.amount,
    currency: 'NGN',
    reference: p.reference,
    callback_url: p.callbackUrl,
    metadata: p.metadata,
  });
}

export function verifyTransaction(reference: string) {
  return call<PaystackTransaction>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
}

export function createRefund(p: { transaction: string; amount: number; reason: string }) {
  return call<{ id: number; status: string; amount: number }>('POST', '/refund', { transaction: p.transaction, amount: p.amount, merchant_note: p.reason });
}

/** Paystack signs webhook bodies with HMAC-SHA512 of the raw body using the secret key (x-paystack-signature). */
export function verifyWebhookSignature(raw: Buffer | undefined, signature: string | undefined): boolean {
  if (!env.PAYSTACK_SECRET_KEY || !raw || !signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
  return timingSafeEqual(Buffer.from(signature.toLowerCase(), 'hex'), Buffer.from(expected, 'hex'));
}
