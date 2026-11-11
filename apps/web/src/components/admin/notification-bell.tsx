'use client';

import type { NotificationDto } from '@mb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { Popover as PP } from 'radix-ui';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';

/** Unread count (polled every minute) with the latest notifications in a popover. */
export function NotificationBell() {
  const qc = useQueryClient();
  const count = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => api.get<{ count: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
  const list = useQuery({ queryKey: ['notifications', 'list'], queryFn: () => api.page<NotificationDto>('/notifications', { limit: 12 }), enabled: false });
  const n = count.data?.count ?? 0;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['notifications'] });

  return (
    <PP.Root onOpenChange={(open) => open && void list.refetch()}>
      <PP.Trigger className="relative rounded-full p-2 text-ink-muted hover:bg-black/5 hover:text-ink" aria-label={`Notifications, ${n} unread`}>
        <Bell className="h-5 w-5" />
        {n > 0 && <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-bold text-white" aria-hidden>{n > 99 ? '99+' : n}</span>}
      </PP.Trigger>
      <PP.Portal>
        <PP.Content align="end" sideOffset={8} className="z-50 w-[22rem] max-w-[calc(100vw-1rem)] rounded-xl border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            {n > 0 && <button className="text-xs font-medium text-brand-700 hover:underline" onClick={async () => { await api.post('/notifications/read-all'); refresh(); }}>Mark all read</button>}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {list.isFetching && !list.data && <li className="px-4 py-6 text-center text-sm text-ink-muted">Loading…</li>}
            {list.data?.data.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-muted">Nothing new.</li>}
            {list.data?.data.map((x) => {
              const body = (
                <>
                  <p className={cn('text-sm', !x.read && 'font-semibold')}>{x.title}</p>
                  <p className="line-clamp-2 text-xs text-ink-muted">{x.body}</p>
                  <p className="mt-0.5 text-[11px] text-ink-faint">{timeAgo(x.createdAt)}</p>
                </>
              );
              const mark = () => { if (!x.read) void api.post(`/notifications/${x.id}/read`).then(refresh); };
              return (
                <li key={x.id} className={cn('border-b border-line last:border-0', !x.read && 'bg-brand-50/40')}>
                  {x.link ? (
                    <PP.Close asChild><Link href={x.link} onClick={mark} className="block px-4 py-2.5 hover:bg-subtle">{body}</Link></PP.Close>
                  ) : (
                    <button onClick={mark} className="block w-full px-4 py-2.5 text-left hover:bg-subtle">{body}</button>
                  )}
                </li>
              );
            })}
          </ul>
        </PP.Content>
      </PP.Portal>
    </PP.Root>
  );
}
