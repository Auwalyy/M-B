'use client';

import type { PageMeta } from '@mb/shared';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Alert, EmptyState, Skeleton } from './display';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Hide on small screens; the first column and actions stay visible. */
  hideOnMobile?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  empty: { icon: LucideIcon; title: string; description?: ReactNode; action?: ReactNode };
  meta?: PageMeta;
  onPageChange?: (page: number) => void;
  caption: string;
}

export function DataTable<T>({ columns, rows, rowKey, loading, error, onRetry, onRowClick, empty, meta, onPageChange, caption }: DataTableProps<T>) {
  if (error) {
    return (
      <div className="p-5">
        <Alert kind="error" title="Could not load data" action={onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}>
          {error}
        </Alert>
      </div>
    );
  }

  const hidden = (c: Column<T>) => (c.hideOnMobile ? 'hidden md:table-cell' : '');

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-subtle">
              {columns.map((c) => (
                <th key={c.header} scope="col" className={cn('px-4 py-2.5 text-xs font-semibold tracking-wide text-ink-muted uppercase', hidden(c), c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading
              ? Array.from({ length: 5 }, (_, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c.header} className={cn('px-4 py-3.5', hidden(c))}>
                        <Skeleton className="h-4 w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows?.map((row) => (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    // Clickable rows are reachable and openable from the keyboard too.
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                            e.preventDefault();
                            onRowClick(row);
                          }
                        : undefined
                    }
                    className={cn(onRowClick && 'cursor-pointer outline-none hover:bg-brand-50/50 focus-visible:bg-brand-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500')}
                  >
                    {columns.map((c) => (
                      <td key={c.header} className={cn('px-4 py-3 align-middle', hidden(c), c.className)}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {!loading && rows?.length === 0 && <EmptyState {...empty} />}
      {meta && onPageChange && meta.pages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-ink-muted">
          <span>
            Page {meta.page} of {meta.pages} · {meta.total} total
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="secondary" disabled={meta.page >= meta.pages} onClick={() => onPageChange(meta.page + 1)} aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
