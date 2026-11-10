'use client';

import { LayoutDashboard, LogOut, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ButtonLink, buttonClasses } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/display';
import { isStaff, useAuth } from '@/lib/auth';

export function UserNav() {
  const { status, user, logout } = useAuth();
  const router = useRouter();

  if (status === 'loading') return <Skeleton className="h-9 w-24" />;
  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <ButtonLink href="/login" variant="ghost" size="sm">Sign in</ButtonLink>
        <ButtonLink href="/register" size="sm" className="hidden sm:inline-flex">Create account</ButtonLink>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      {isStaff(user) && (
        <Link href="/admin" className={buttonClasses('ghost', 'sm')}>
          <LayoutDashboard className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Dashboard</span>
        </Link>
      )}
      <Link href="/account" className={buttonClasses('ghost', 'sm')}>
        <User className="h-4 w-4" aria-hidden /> <span className="hidden max-w-32 truncate sm:inline">{user.fullName.split(' ')[0]}</span>
      </Link>
      <button
        className={buttonClasses('ghost', 'icon')}
        aria-label="Sign out"
        onClick={async () => {
          await logout();
          router.push('/');
        }}
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
