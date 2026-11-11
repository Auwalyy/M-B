/**
 * Calendar days in Africa/Lagos (UTC+1 all year, no daylight saving).
 * Reports take inclusive day ranges written as YYYY-MM-DD.
 */
export const BUSINESS_TIMEZONE = 'Africa/Lagos';
const OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The Lagos calendar day of an instant, as YYYY-MM-DD. */
export function lagosDay(at: Date = new Date()): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant a Lagos calendar day starts. */
export function lagosDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+01:00`);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Days in an inclusive range (a single day is 1). */
export function daysInRange(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Default report window: the last 30 days including today. */
export function defaultRange(today = lagosDay()): { from: string; to: string } {
  return { from: addDays(today, -29), to: today };
}
