/**
 * Phone number helpers. Numbers are stored in E.164 format (+2348031234567) so a customer
 * is recognised across branches however staff typed the number.
 */

const NON_DIGITS = /[^\d+]/g;

/**
 * Normalise a phone number to E.164. Nigerian local formats are converted to +234.
 * Returns null when the input is not a plausible phone number.
 *
 *   08031234567       -> +2348031234567
 *   2348031234567     -> +2348031234567
 *   +234 803 123 4567 -> +2348031234567
 *   8031234567        -> +2348031234567
 *   +447911123456     -> +447911123456  (international numbers are kept)
 */
export function normalizePhone(input: string): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(NON_DIGITS, '');
  if (!s) return null;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;

  if (s.startsWith('+')) {
    const digits = s.slice(1);
    if (!/^\d+$/.test(digits)) return null;
    if (digits.startsWith('234')) return normalizeNigerianNsn(digits.slice(3));
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (!/^\d+$/.test(s)) return null;
  if (s.startsWith('234') && s.length >= 11) return normalizeNigerianNsn(s.slice(3));
  if (s.startsWith('0')) return normalizeNigerianNsn(s.slice(1));
  if (s.length === 10 && /^[789]/.test(s)) return normalizeNigerianNsn(s);
  return null;
}

/** National significant number: 10 digits for mobiles (70x/80x/81x/90x/91x), 8–9 for landlines. */
function normalizeNigerianNsn(nsn: string): string | null {
  const n = nsn.startsWith('0') ? nsn.slice(1) : nsn;
  if (/^[789][01]\d{8}$/.test(n)) return `+234${n}`;
  if (/^[1-9]\d{7,8}$/.test(n)) return `+234${n}`;
  return null;
}

/** Format an E.164 Nigerian mobile number for display: +234 803 123 4567. */
export function formatPhone(e164: string): string {
  const m = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+234 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** Digits only, as required by wa.me links. */
export function toWhatsAppNumber(e164: string): string {
  return e164.replace(/\D/g, '');
}
