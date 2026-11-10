/**
 * Money is stored and computed as integer kobo (₦1 = 100 kobo) to avoid floating-point errors.
 */

export type Kobo = number;

export function nairaToKobo(naira: number): Kobo {
  if (!Number.isFinite(naira)) throw new RangeError('Amount must be a finite number');
  return Math.round(naira * 100);
}

export function koboToNaira(kobo: Kobo): number {
  return kobo / 100;
}

const formatter = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** ₦250,000 or ₦1,250.5 */
export function formatNaira(kobo: Kobo): string {
  return formatter.format(kobo / 100);
}
