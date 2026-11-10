import { describe, expect, it } from 'vitest';
import { formatPhone, normalizePhone, toWhatsAppNumber } from '../phone';

describe('normalizePhone', () => {
  it.each([
    ['08031234567', '+2348031234567'],
    ['0803 123 4567', '+2348031234567'],
    ['0803-123-4567', '+2348031234567'],
    ['+234 803 123 4567', '+2348031234567'],
    ['+234 0803 123 4567', '+2348031234567'],
    ['2348031234567', '+2348031234567'],
    ['8031234567', '+2348031234567'],
    ['09012345678', '+2349012345678'],
    ['07012345678', '+2347012345678'],
    ['00447911123456', '+447911123456'],
    ['+447911123456', '+447911123456'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', 'abc', '123', '080312', '+234123', '0803123456789'])('rejects "%s"', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('formats Nigerian numbers for display and WhatsApp links', () => {
    expect(formatPhone('+2348031234567')).toBe('+234 803 123 4567');
    expect(toWhatsAppNumber('+2348031234567')).toBe('2348031234567');
  });
});
