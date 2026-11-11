'use client';

import { type ReportGrouping, type SalesPointDto, formatNaira } from '@mb/shared';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/display';
import { cn } from '@/lib/utils';

/**
 * Chart colours, checked with the data-viz palette validator against the white surface:
 * sales (green) and collections (gold) pass lightness, chroma, contrast and normal-vision
 * separation. Their colour-blind separation is in the 6–8 band, so the two series also differ
 * by mark (columns vs a line with dots) and are always named in a legend.
 */
export const SERIES = { sales: '#1f8a5f', collected: '#b8862b' } as const;
const GRID = '#e6e3db';

const compact = new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 1 });
/** ₦1.2M style, for axes and tiles. Input in kobo. */
export const compactNaira = (kobo: number) => `₦${compact.format(kobo / 100)}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function periodLabel(period: string, unit: ReportGrouping, long = false): string {
  const [y, m, d] = period.split('-').map(Number) as [number, number, number];
  if (unit === 'month') return `${MONTHS[m - 1]} ${y}`;
  const day = `${d} ${MONTHS[m - 1]}`;
  return unit === 'week' ? (long ? `Week of ${day} ${y}` : `w/c ${day}`) : long ? `${day} ${y}` : day;
}

// ------------------------------------------------------------------ Stat tile

/** A headline figure with its change against the previous period. */
export function StatTile({ label, value, previous, format = (n) => n.toLocaleString('en-NG'), upIsGood = true, hint, loading }: {
  label: string;
  value: number | null | undefined;
  previous?: number;
  format?: (n: number) => string;
  upIsGood?: boolean;
  hint?: ReactNode;
  loading?: boolean;
}) {
  let delta: ReactNode = null;
  if (value != null && previous !== undefined) {
    const diff = value - previous;
    const pct = previous ? Math.round((diff / previous) * 100) : null;
    const good = diff === 0 ? null : diff > 0 === upIsGood;
    const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
    delta = (
      <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', good === null ? 'text-ink-muted' : good ? 'text-success-700' : 'text-danger-700')}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {diff === 0 ? 'No change' : pct === null ? 'New' : `${diff > 0 ? '+' : ''}${pct}%`}
        <span className="font-normal text-ink-muted">vs previous period</span>
      </span>
    );
  }
  return (
    <Card className="p-5">
      <p className="text-sm font-medium text-ink-muted">{label}</p>
      {loading ? (
        <div className="mt-2 h-8 w-24 animate-pulse rounded bg-subtle" />
      ) : (
        <p className="mt-1 text-2xl font-semibold tracking-tight text-ink tabular-nums" title={value != null ? format(value) : undefined}>
          {value == null ? '—' : format(value)}
        </p>
      )}
      <div className="mt-1 min-h-4">{loading ? null : (delta ?? (hint && <span className="text-xs text-ink-muted">{hint}</span>))}</div>
      {delta && hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </Card>
  );
}

// ------------------------------------------------------------------ Sales over time

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(v: number): number {
  if (v <= 0) return 100_00; // ₦100 so an empty chart still has an axis
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

/**
 * Gross sales as columns and collected revenue as a line, over one money axis.
 * Hover, touch or arrow keys show both values for a period; the table below lists every value.
 */
export function SalesChart({ points, unit, loading }: { points: SalesPointDto[]; unit: ReportGrouping; loading?: boolean }) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const showCollected = points.some((p) => p.collectedRevenue !== null);
  const H = 240;
  const pad = { l: 56, r: 12, t: 12, b: 28 };
  const plotW = Math.max(0, width - pad.l - pad.r);
  const plotH = H - pad.t - pad.b;
  const max = niceMax(Math.max(0, ...points.map((p) => Math.max(p.grossSales, p.collectedRevenue ?? 0))));
  const band = points.length ? plotW / points.length : 0;
  const barW = Math.max(2, Math.min(24, band - 2));
  const x = (i: number) => pad.l + band * i + band / 2;
  const y = (v: number) => pad.t + plotH - (Math.max(0, v) / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 64))));

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - pad.l) / band);
    setActive(i >= 0 && i < points.length ? i : null);
  };
  const keys = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setActive((a) => Math.min(points.length - 1, Math.max(0, (a ?? (e.key === 'ArrowLeft' ? points.length : -1)) + (e.key === 'ArrowLeft' ? -1 : 1))));
  };
  const line = showCollected
    ? points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.collectedRevenue ?? 0).toFixed(1)}`).join('')
    : '';
  const ap = active !== null ? points[active] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.sales }} />Gross sales</span>
        {showCollected && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="10" aria-hidden><line x1="1" y1="5" x2="17" y2="5" stroke={SERIES.collected} strokeWidth="2" strokeLinecap="round" /><circle cx="9" cy="5" r="3" fill={SERIES.collected} /></svg>
            Collected revenue
          </span>
        )}
      </div>
      <div ref={wrap} className={cn('relative w-full transition-opacity', loading && 'opacity-50')} style={{ height: H }}>
        {width > 0 && (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={`Gross sales${showCollected ? ' and collected revenue' : ''} by ${unit}. Use the left and right arrow keys to read each ${unit}.`}
            tabIndex={0}
            className="block touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={() => setActive(null)}
            onKeyDown={keys}
            onBlur={() => setActive(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
                <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-muted text-[11px] tabular-nums">{compactNaira(t)}</text>
              </g>
            ))}
            {active !== null && <rect x={pad.l + band * active} y={pad.t} width={band} height={plotH} className="fill-subtle" />}
            {points.map((p, i) => {
              const h = Math.max(0, y(0) - y(p.grossSales));
              if (!h) return null;
              const r = Math.min(4, barW / 2, h);
              const x0 = x(i) - barW / 2;
              const top = y(p.grossSales);
              return (
                <path
                  key={p.period}
                  d={`M${x0},${y(0)}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + barW - r}Q${x0 + barW},${top} ${x0 + barW},${top + r}V${y(0)}Z`}
                  fill={SERIES.sales}
                  opacity={active === null || active === i ? 1 : 0.55}
                />
              );
            })}
            {showCollected && <path d={line} fill="none" stroke={SERIES.collected} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {showCollected && ap && <circle cx={x(active!)} cy={y(ap.collectedRevenue ?? 0)} r={4.5} fill={SERIES.collected} stroke="#fff" strokeWidth={2} />}
            {points.map((p, i) =>
              i % labelEvery === 0 ? (
                <text key={p.period} x={x(i)} y={H - 8} textAnchor="middle" className="fill-ink-muted text-[11px]">{periodLabel(p.period, unit)}</text>
              ) : null,
            )}
          </svg>
        )}
        {ap && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-44 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop"
            style={x(active!) > width / 2 ? { right: width - x(active!) + 12 } : { left: x(active!) + 12 }}
            role="status"
          >
            <p className="mb-1 font-medium text-ink-muted">{periodLabel(ap.period, unit, true)}</p>
            <p className="flex items-center gap-2"><span className="h-0.5 w-3 rounded" style={{ background: SERIES.sales }} /><strong className="text-sm text-ink tabular-nums">{formatNaira(ap.grossSales)}</strong><span className="text-ink-muted">gross sales · {ap.orders} order{ap.orders === 1 ? '' : 's'}</span></p>
            {ap.collectedRevenue !== null && (
              <p className="mt-0.5 flex items-center gap-2"><span className="h-0.5 w-3 rounded" style={{ background: SERIES.collected }} /><strong className="text-sm text-ink tabular-nums">{formatNaira(ap.collectedRevenue)}</strong><span className="text-ink-muted">collected</span></p>
            )}
          </div>
        )}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-ink-muted hover:text-ink">Show as table</summary>
        <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-subtle text-xs text-ink-muted"><tr><th className="px-3 py-2 font-medium">Period</th><th className="px-3 py-2 text-right font-medium">Orders</th><th className="px-3 py-2 text-right font-medium">Gross sales</th>{showCollected && <th className="px-3 py-2 text-right font-medium">Collected</th>}</tr></thead>
            <tbody className="divide-y divide-line">
              {points.map((p) => (
                <tr key={p.period}><td className="px-3 py-1.5">{periodLabel(p.period, unit, true)}</td><td className="px-3 py-1.5 text-right tabular-nums">{p.orders}</td><td className="px-3 py-1.5 text-right tabular-nums">{formatNaira(p.grossSales)}</td>{showCollected && <td className="px-3 py-1.5 text-right tabular-nums">{formatNaira(p.collectedRevenue ?? 0)}</td>}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ------------------------------------------------------------------ Ranked bars

/** Horizontal bars with the value at the tip. Every value is printed, so no hover is needed. */
export function BarList({ items, empty }: { items: { key: string; label: ReactNode; value: number; display: string; sub?: ReactNode }[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-ink-muted">{empty}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink">{i.label}</span>
            <span className="shrink-0 font-semibold text-ink tabular-nums">{i.display}</span>
          </div>
          <div className="h-2 rounded-full bg-subtle" aria-hidden>
            <div className="h-2 rounded-full" style={{ width: `${Math.max(1, (i.value / max) * 100)}%`, background: SERIES.sales }} />
          </div>
          {i.sub && <p className="mt-1 text-xs text-ink-muted">{i.sub}</p>}
        </li>
      ))}
    </ul>
  );
}
