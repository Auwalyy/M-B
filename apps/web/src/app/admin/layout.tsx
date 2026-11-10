'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { AdminShell } from '@/components/admin/admin-shell';
import { Logo } from '@/components/brand';
import { Skeleton } from '@/components/ui/display';
import { isStaff, useAuth } from '@/lib/auth';

/**
 * Client-side guard for the admin area. It only decides what to render;
 * every API call is authorised again on the server.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (user?.mustChangePassword) router.replace('/change-password');
    else if (user && !isStaff(user)) router.replace('/account');
  }, [status, user, router, pathname]);

  if (!user || !isStaff(user) || user.mustChangePassword) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4" aria-busy>
        <Logo compact />
        <Skeleton className="h-2 w-40" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }
  return <AdminShell user={user}>{children}</AdminShell>;
}
