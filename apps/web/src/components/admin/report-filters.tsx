'use client';

import { addDays, lagosDay } from '@mb/shared';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { BranchSelect } from '@/components/admin/commerce';
import { Input, Select } from '@/components/ui/field';

export interface ReportFilter {
  from: string;
  to: string;
  branch: string;
  preset: string;
}

const PRESETS: { key: string; label: string; range: (today: string) => { from: string; to: string } }[] = [
  { key: 'today', label: 'Today', range: (t) => ({ from: t, to: t }) },
  { key: '7d', label: 'Last 7 days', range: (t) => ({ from: addDays(t, -6), to: t }) },
  { key: '30d', label: 'Last 30 days', range: (t) => ({ from: addDays(t, -29), to: t }) },
  { key: '90d', label: 'Last 90 days', range: (t) => ({ from: addDays(t, -89), to: t }) },
  { key: 'month', label: 'This month', range: (t) => ({ from: `${t.slice(0, 7)}-01`, to: t }) },
  { key: 'year', label: 'This year', range: (t) => ({ from: `${t.slice(0, 4)}-01-01`, to: t }) },
];

/**
 * Date range and branch, kept in the address bar so a report can be bookmarked or shared
 * with someone who has the same access. Defaults to the last 30 days.
 */
export function useReportFilter(): [ReportFilter, (patch: Partial<Record<'from' | 'to' | 'branch' | 'preset', string>>) => void, URLSearchParams] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filter = useMemo<ReportFilter>(() => {
    const today = lagosDay();
    const preset = params.get('range') ?? '30d';
    const p = PRESETS.find((x) => x.key === preset);
    const range = p ? p.range(today) : { from: params.get('from') ?? addDays(today, -29), to: params.get('to') ?? today };
    return { ...range, branch: params.get('branch') ?? '', preset: p ? preset : 'custom' };
  }, [params]);
  const set = useCallback(
    (patch: Partial<Record<'from' | 'to' | 'branch' | 'preset', string>>) => {
      const next = new URLSearchParams(params);
      if (patch.preset !== undefined) {
        next.set('range', patch.preset);
        if (patch.preset === 'custom') {
          next.set('from', filter.from);
          next.set('to', filter.to);
        } else {
          next.delete('from');
          next.delete('to');
        }
      }
      for (const k of ['from', 'to'] as const) {
        if (patch[k] !== undefined) {
          next.set('range', 'custom');
          next.set(k, patch[k]!);
        }
      }
      if (patch.branch) next.set('branch', patch.branch);
      else if (patch.branch === '') next.delete('branch');
      next.delete('page');
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router, filter.from, filter.to],
  );
  return [filter, set, params];
}

/** One row above everything it filters. */
export function ReportFilters({ filter, onChange, showRange = true, children }: {
  filter: ReportFilter;
  onChange: ReturnType<typeof useReportFilter>[1];
  showRange?: boolean;
  children?: React.ReactNode;
}) {
  const today = lagosDay();
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3 print:hidden">
      {showRange && (
        <>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-ink-muted">Period</span>
            <Select value={filter.preset} onChange={(e) => onChange({ preset: e.target.value })} className="w-40">
              {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              <option value="custom">Custom dates</option>
            </Select>
          </label>
          {filter.preset === 'custom' && (
            <>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-ink-muted">From</span>
                <Input type="date" value={filter.from} max={filter.to} onChange={(e) => e.target.value && onChange({ from: e.target.value })} className="w-40" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-ink-muted">To</span>
                <Input type="date" value={filter.to} min={filter.from} max={today} onChange={(e) => e.target.value && onChange({ to: e.target.value })} className="w-40" />
              </label>
            </>
          )}
        </>
      )}
      <div className="text-sm">
        <span className="mb-1 block font-medium text-ink-muted" aria-hidden>Branch</span>
        <BranchSelect value={filter.branch} onChange={(b) => onChange({ branch: b })} allowAll label="Branch" />
      </div>
      {children}
    </div>
  );
}
