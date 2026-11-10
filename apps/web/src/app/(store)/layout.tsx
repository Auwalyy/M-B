import { type PublicSettingsDto, formatPhone, toWhatsAppNumber } from '@mb/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand';
import { UserNav } from '@/components/store/user-nav';
import { serverGet } from '@/lib/server-api';

export default async function StoreLayout({ children }: { children: ReactNode }) {
  const settings = await serverGet<PublicSettingsDto>('/settings');
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Logo />
          <nav aria-label="Main" className="flex items-center gap-1">
            <Link href="/branches" className="rounded-md px-3 py-2 text-sm font-medium text-ink-muted hover:bg-black/5 hover:text-ink">
              Branches
            </Link>
            <UserNav />
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">{children}</main>

      <footer className="mt-16 bg-brand-900 text-brand-100">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3">
          <div>
            <Logo inverse />
            <p className="mt-4 max-w-xs text-sm text-brand-200">{settings?.tagline ?? 'Quality products across Kano and Abuja.'}</p>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Visit us</h2>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link href="/branches" className="hover:text-white">All branches and opening hours</Link></li>
            </ul>
          </div>
          {settings && (
            <div>
              <h2 className="text-sm font-semibold text-white">Contact</h2>
              <ul className="mt-3 space-y-2 text-sm">
                <li><a href={`tel:${settings.supportPhone}`} className="hover:text-white">{formatPhone(settings.supportPhone)}</a></li>
                <li><a href={`https://wa.me/${toWhatsAppNumber(settings.whatsapp)}`} target="_blank" rel="noopener noreferrer" className="hover:text-white">WhatsApp {formatPhone(settings.whatsapp)}</a></li>
                <li><a href={`mailto:${settings.supportEmail}`} className="hover:text-white">{settings.supportEmail}</a></li>
              </ul>
            </div>
          )}
        </div>
        <div className="border-t border-white/10">
          <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-brand-300">© {year} {settings?.companyName ?? 'Mudassir & Brothers'}. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
