import { describe, expect, it } from 'vitest';
import { csvCell, csvLine, lagosDateTime, naira } from './csv';

describe('CSV cells', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Zoo Road, Kano')).toBe('"Zoo Road, Kano"');
    expect(csvCell('6" fan')).toBe('"6"" fan"');
    expect(csvLine(['a', 1, null, true])).toBe('a,1,,yes\r\n');
  });

  it('neutralises formulas but leaves phone numbers and negative amounts readable', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-1+1')).toBe("'-1+1");
    expect(csvCell('+2348031234567')).toBe('+2348031234567');
    expect(csvCell('-1500.00')).toBe('-1500.00');
  });

  it('formats money and Lagos time', () => {
    expect(naira(123456)).toBe('1234.56');
    expect(naira(null)).toBeNull();
    expect(lagosDateTime('2026-03-01T23:30:00Z')).toBe('2026-03-02 00:30');
  });
});
