import type { ReactNode } from 'react';
import { Logo } from '@/components/brand';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-brand-800 p-10 text-white lg:flex lg:flex-col">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(226,189,106,0.25),transparent_60%)]" />
        <Logo inverse className="relative" />
        <div className="relative mt-auto max-w-md">
          <p className="text-3xl font-bold tracking-tight text-balance">One business. Every branch. One place to run it.</p>
          <p className="mt-4 text-brand-200">
            Customers shop and reserve online. Staff manage their branch. The head office sees the whole company.
          </p>
        </div>
      </aside>
      <main className="flex flex-col px-4 py-8 sm:px-8">
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">{children}</div>
      </main>
    </div>
  );
}
