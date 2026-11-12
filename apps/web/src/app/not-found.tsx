import { Logo } from '@/components/brand';
import { ButtonLink } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Logo compact />
      <p className="mt-8 text-sm font-semibold tracking-wide text-accent-700 uppercase">Page not found</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">We could not find that page</h1>
      <p className="mt-2 max-w-md text-ink-muted">The link may be old, or the page may have moved.</p>
      <div className="mt-8 flex gap-3">
        <ButtonLink href="/">Go to the homepage</ButtonLink>
        <ButtonLink href="/branches" variant="secondary">Find a branch</ButtonLink>
      </div>
    </div>
  );
}
