import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Monogram and wordmark. `inverse` is for dark backgrounds. */
export function Logo({ inverse, compact, href = '/', className }: { inverse?: boolean; compact?: boolean; href?: string; className?: string }) {
  return (
    <Link href={href} className={cn('group inline-flex items-center gap-2.5', className)} aria-label="Mudassir & Brothers home">
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-extrabold tracking-tight',
          inverse ? 'bg-white text-brand-800' : 'bg-brand-700 text-white',
        )}
        aria-hidden
      >
        M<span className="text-accent-300">&amp;</span>B
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className={cn('block text-[15px] font-bold tracking-tight', inverse ? 'text-white' : 'text-ink')}>Mudassir &amp; Brothers</span>
          <span className={cn('block text-[11px] font-medium tracking-wide uppercase', inverse ? 'text-brand-200' : 'text-ink-faint')}>Kano · Abuja</span>
        </span>
      )}
    </Link>
  );
}
