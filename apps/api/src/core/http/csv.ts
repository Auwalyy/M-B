import type { Response } from 'express';

export type CsvCell = string | number | boolean | null | undefined;

/**
 * One CSV field. Text that a spreadsheet would run as a formula (starting with = + - @ or a
 * control character) gets a leading apostrophe, so an exported customer name cannot execute.
 * A lone signed number, such as the phone number +2348031234567, is not a formula and is left alone.
 */
export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  let s = v;
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: CsvCell[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}

/** Kobo as naira with two decimals, for spreadsheets. */
export const naira = (kobo: number | null | undefined): CsvCell => (kobo == null ? null : (kobo / 100).toFixed(2));

/** An instant as Lagos local time, "YYYY-MM-DD HH:mm". */
export function lagosDateTime(d: Date | string | null | undefined): string {
  if (!d) return '';
  return new Date(new Date(d).getTime() + 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * Streams a CSV download. A byte-order mark lets Excel read UTF-8 names (e.g. "Ṣọlá") correctly.
 */
export async function sendCsv(res: Response, filename: string, header: string[], rows: AsyncIterable<CsvCell[]> | Iterable<CsvCell[]>): Promise<number> {
  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.write(`\uFEFF${csvLine(header)}`);
  let count = 0;
  for await (const row of rows) {
    count++;
    if (!res.write(csvLine(row))) await new Promise<void>((resolve) => res.once('drain', resolve));
  }
  res.end();
  return count;
}
