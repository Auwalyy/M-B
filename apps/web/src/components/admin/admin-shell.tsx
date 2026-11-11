'use client';

import type { AuthUserDto } from '@mb/shared';
import { ChevronDown, ExternalLink, LogOut, Menu, UserCircle, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Dialog as D, DropdownMenu as DM } from 'radix-ui';
import { type ReactNode, useEffect, useState } from 'react';
import { Logo } from '@/components/brand';
import { NotificationBell } from './notification-bell';
import { useAuth } from '@/lib/auth';
import { activeHref, visibleNav } from '@/lib/nav';
import { cn } from '@/lib/utils';

function ScopeLabel({ user }: { user: AuthUserDto }) {
  if (user.scope === 'company') return <>All branches</>;
  const codes = user.branches.map((b) => b.code);
  if (user.grants.length) codes.push(...user.grants.map((g) => `${g.branch.code}*`));
  return <>{codes.join(', ') || 'No branch assigned'}</>;
}

function Sidebar({ user, onNavigate }: { user: AuthUserDto; onNavigate?: () => void }) {
  const pathname = usePathname();
  const nav = visibleNav(user);
  const active = activeHref(pathname, nav);
  return (
    <div className="flex h-full flex-col bg-brand-900 text-brand-100">
      <div className="flex h-16 items-center px-5">
        <Logo inverse href="/admin" />
      </div>
      <div className="mx-4 mb-4 rounded-lg bg-white/5 px-3 py-2.5">
        <p className="text-[11px] font-semibold tracking-wide text-brand-300 uppercase">{user.roleName}</p>
        <p className="mt-0.5 truncate text-sm font-medium text-white"><ScopeLabel user={user} /></p>
      </div>
      <nav aria-label="Admin" className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        {nav.map((section, i) => (
          <div key={section.title ?? i}>
            {section.title && <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-brand-400 uppercase">{section.title}</p>}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = item.href === active;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive ? 'bg-white text-brand-800 shadow-sm' : 'text-brand-100 hover:bg-white/10 hover:text-white',
                      )}
                    >
                      <item.icon className={cn('h-[18px] w-[18px]', isActive ? 'text-brand-600' : 'text-brand-300')} aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

function UserMenu({ user }: { user: AuthUserDto }) {
  const { logout } = useAuth();
  const router = useRouter();
  const initials = user.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <DM.Root>
      <DM.Trigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/5" aria-label="Account menu">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-100 text-xs font-bold text-accent-700">{initials}</span>
        <span className="hidden text-left sm:block">
          <span className="block max-w-40 truncate text-sm font-semibold text-ink">{user.fullName}</span>
          <span className="block text-xs text-ink-muted">{user.roleName}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-ink-faint" aria-hidden />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={6} className="z-50 min-w-52 rounded-lg border border-line bg-surface p-1 shadow-pop">
          <DM.Item asChild>
            <Link href="/admin/profile" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-subtle">
              <UserCircle className="h-4 w-4 text-ink-muted" /> My profile
            </Link>
          </DM.Item>
          <DM.Item asChild>
            <Link href="/" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-subtle">
              <ExternalLink className="h-4 w-4 text-ink-muted" /> View storefront
            </Link>
          </DM.Item>
          <DM.Separator className="my-1 h-px bg-line" />
          <DM.Item
            onSelect={async () => {
              await logout();
              router.replace('/login');
            }}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-danger-700 outline-none data-[highlighted]:bg-danger-50"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function AdminShell({ user, children }: { user: AuthUserDto; children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  useEffect(() => setDrawer(false), [pathname]);

  return (
    <div className="min-h-dvh lg:pl-64 print:pl-0">
      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block print:hidden">
        <Sidebar user={user} />
      </aside>

      <D.Root open={drawer} onOpenChange={setDrawer}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-ink/50 lg:hidden" />
          <D.Content className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] shadow-pop focus:outline-none lg:hidden">
            <D.Title className="sr-only">Navigation</D.Title>
            <D.Description className="sr-only">Admin sections</D.Description>
            <Sidebar user={user} onNavigate={() => setDrawer(false)} />
            <D.Close className="absolute top-4 right-3 rounded-md p-1.5 text-brand-200 hover:bg-white/10" aria-label="Close menu">
              <X className="h-5 w-5" />
            </D.Close>
          </D.Content>
        </D.Portal>
      </D.Root>

      <header className="sticky top-0 z-30 flex h-16 print:hidden items-center justify-between gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6">
        <button className="rounded-md p-2 text-ink-muted hover:bg-black/5 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </button>
        <div className="lg:hidden"><Logo compact href="/admin" /></div>
        <div className="hidden lg:block" />
        <div className="flex items-center gap-1">
          <NotificationBell />
          <UserMenu user={user} />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}
