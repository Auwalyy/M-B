import { describe, expect, it } from 'vitest';
import { addDays, daysInRange, defaultRange, lagosDay, lagosDayStart } from '../dates';
import { analyticsRangeQuery, salesSeriesQuery } from '../schemas/analytics';

describe('Lagos calendar days', () => {
  it('rolls over at midnight Lagos time, not UTC', () => {
    expect(lagosDay(new Date('2026-03-01T22:59:59Z'))).toBe('2026-03-01');
    expect(lagosDay(new Date('2026-03-01T23:00:00Z'))).toBe('2026-03-02');
    expect(lagosDayStart('2026-03-02').toISOString()).toBe('2026-03-01T23:00:00.000Z');
  });

  it('adds days across months and leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysInRange('2026-01-01', '2026-01-31')).toBe(31);
    expect(defaultRange('2026-11-11')).toEqual({ from: '2026-10-13', to: '2026-11-11' });
  });
});

describe('report range validation', () => {
  it('accepts a sensible range and rejects reversed, overlong or impossible ones', () => {
    expect(analyticsRangeQuery.safeParse({ from: '2026-01-01', to: '2026-01-31' }).success).toBe(true);
    expect(analyticsRangeQuery.safeParse({ from: '2026-02-01', to: '2026-01-31' }).success).toBe(false);
    expect(analyticsRangeQuery.safeParse({ from: '2023-01-01', to: '2026-01-31' }).success).toBe(false);
    expect(analyticsRangeQuery.safeParse({ from: '2026-13-01' }).success).toBe(false);
    expect(analyticsRangeQuery.safeParse({ from: '2026-02-31' }).success).toBe(false);
    expect(salesSeriesQuery.parse({}).groupBy).toBe('day');
  });
});
