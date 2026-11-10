import { describe, expect, it } from 'vitest';
import { formatNaira, koboToNaira, nairaToKobo } from '../money';

describe('money', () => {
  it('converts without floating point drift', () => {
    expect(nairaToKobo(0.1 + 0.2)).toBe(30);
    expect(nairaToKobo(1250.5)).toBe(125050);
    expect(koboToNaira(125050)).toBe(1250.5);
  });

  it('formats naira', () => {
    expect(formatNaira(25_000_000)).toMatch(/250,000/);
  });

  it('rejects non-finite input', () => {
    expect(() => nairaToKobo(Number.NaN)).toThrow(RangeError);
  });
});
