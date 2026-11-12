import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'Mudassir & Brothers', template: '%s · Mudassir & Brothers' },
  description: 'Quality products from Mudassir & Brothers branches across Kano and Abuja. Shop online, reserve, or visit a branch near you.',
  applicationName: 'Mudassir & Brothers',
  openGraph: { siteName: 'Mudassir & Brothers', type: 'website', locale: 'en_NG' },
};

export const viewport: Viewport = {
  themeColor: '#0f4c3a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG" className={jakarta.variable}>
      <head>
        {/* Must run before any bundle: tells Zod not to probe for eval(), which the Content-Security-Policy blocks. */}
        <script dangerouslySetInnerHTML={{ __html: 'globalThis.__zod_globalConfig={jitless:true};' }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
